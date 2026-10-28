import asyncio
import time
from pathlib import Path
from typing import Optional

import httpx
import yaml
from fastapi import HTTPException

from config import settings


class MediaMTXClient:
    _instance = None

    # RAM Version Control / State cache
    _cache_lock = asyncio.Lock()
    _ram_config = {}
    _cache_loaded = False
    _yaml_path = Path("mediamtx.yml")
    _is_dirty = False
    _last_modified = 0.0
    _debounce_seconds = 300.0  # Simpan ke file jika sudah tenang selama 5 menit

    def __init__(self):
        base = str(settings.MEDIAMTX_API_URL).rstrip("/")
        self.base_url = f"{base}/v3"
        self.client = httpx.AsyncClient(timeout=10.0)
        self.yaml_path = self._yaml_path
        if not MediaMTXClient._cache_loaded:
            self._load_initial_cache()

    def _load_initial_cache(self):
        """Memuat konfigurasi awal dari file yml ke RAM saat pertama kali inisialisasi."""
        try:
            if self.yaml_path.exists():
                MediaMTXClient._ram_config = yaml.safe_load(self.yaml_path.read_text()) or {}
            MediaMTXClient._cache_loaded = True
        except Exception as e:
            print(f"[Warning] Gagal memuat cache mediamtx.yml: {e}")

    async def _queue_save_to_yaml(self, new_config: dict, path_name: Optional[str] = None):
        """Mencatat perubahan ke RAM terlebih dahulu dan menandai dirty (debounce pattern)."""
        async with self._cache_lock:
            if path_name:
                if "paths" not in MediaMTXClient._ram_config or not isinstance(MediaMTXClient._ram_config["paths"], dict):
                    MediaMTXClient._ram_config["paths"] = {}
                if path_name not in MediaMTXClient._ram_config["paths"] or not isinstance(MediaMTXClient._ram_config["paths"][path_name], dict):
                    MediaMTXClient._ram_config["paths"][path_name] = {}
                MediaMTXClient._ram_config["paths"][path_name].update(new_config)
            else:
                MediaMTXClient._ram_config.update(new_config)

            MediaMTXClient._is_dirty = True
            MediaMTXClient._last_modified = time.time()

        # Jalankan background task untuk debounce save
        asyncio.create_task(self._debounce_flush())

    async def _debounce_flush(self):
        """Menunggu hingga aktivitas konfigurasi mereda sebelum menulis ke disk."""
        await asyncio.sleep(self._debounce_seconds)
        async with self._cache_lock:
            if MediaMTXClient._is_dirty and (time.time() - MediaMTXClient._last_modified >= self._debounce_seconds):
                try:
                    self.yaml_path.write_text(yaml.dump(MediaMTXClient._ram_config, sort_keys=False, allow_unicode=True))
                    MediaMTXClient._is_dirty = False
                    print("[Info] Konfigurasi berhasil disinkronkan ke mediamtx.yml (Debounced).")
                except Exception as e:
                    print(f"[Warning] Gagal flush ke mediamtx.yml: {e}")

    @classmethod
    def force_flush_sync(cls):
        """Dipanggil saat shutdown aplikasi untuk memastikan tidak ada data RAM yang tertinggal."""
        if cls._is_dirty and cls._yaml_path.exists():
            try:
                cls._yaml_path.write_text(yaml.dump(cls._ram_config, sort_keys=False, allow_unicode=True))
                cls._is_dirty = False
                print("[Info] Final sync: mediamtx.yml berhasil diperbarui.")
            except Exception as e:
                print(f"[Error] Gagal final sync ke mediamtx.yml: {e}")

    # --- Server ---
    async def get_server_health(self):
        try:
            r = await self.client.get(f"{self.base_url}/info")
            r.raise_for_status()
            return {"connected": True, **r.json()}
        except httpx.HTTPError:
            return {"connected": False, "version": "unknown"}

    async def get_server_config(self):
        r = await self.client.get(f"{self.base_url}/config/global/get")
        r.raise_for_status()
        return r.json()

    async def patch_server_config(self, payload):
        r = await self.client.patch(
            f"{self.base_url}/config/global/patch", json=payload
        )
        r.raise_for_status()
        await self._queue_save_to_yaml(payload)
        return r.json()

    # --- Paths ---
    async def list_paths(self):
        r = await self.client.get(f"{self.base_url}/config/paths/list")
        r.raise_for_status()
        return r.json()

    async def create_path(self, name, source, source_on_demand):
        data = {"sourceOnDemand": source_on_demand}
        if source:
            data["source"] = source
        r = await self.client.post(f"{self.base_url}/config/paths/add/{name}", json=data)
        r.raise_for_status()
        await self._queue_save_to_yaml(data, path_name=name)
        return r.json()

    async def get_path(self, name):
        r = await self.client.get(f"{self.base_url}/config/paths/get/{name}")
        if r.status_code == 404:
            raise HTTPException(404, "Path not found")
        r.raise_for_status()
        return r.json()

    async def update_path(self, name, payload):
        r = await self.client.patch(
            f"{self.base_url}/config/paths/patch/{name}",
            json=payload,
        )
        if r.status_code == 404:
            raise HTTPException(404, "Path not found")
        r.raise_for_status()
        await self._queue_save_to_yaml(payload, path_name=name)
        return r.json()

    async def delete_path(self, name):
        r = await self.client.delete(f"{self.base_url}/config/paths/delete/{name}")
        if r.status_code == 404:
            raise HTTPException(404, "Path not found")
        r.raise_for_status()
        async with self._cache_lock:
            paths = MediaMTXClient._ram_config.get("paths", {})
            if isinstance(paths, dict):
                paths.pop(name, None)
            MediaMTXClient._is_dirty = True
            MediaMTXClient._last_modified = time.time()
        asyncio.create_task(self._debounce_flush())

    # --- Streams ---
    async def list_streams(self):
        r = await self.client.get(f"{self.base_url}/paths/list")
        r.raise_for_status()
        data = r.json()
        items = data.get("items", []) or []
        
        normalized = []
        for s in items:
            normalized.append({
                "name": s.get("name", "unknown"),
                "ready": s.get("ready", False),
                "tracks": s.get("tracks", []) or [],
                "readers": len(s.get("readers", [])) if isinstance(s.get("readers"), list) else 0,
                "bytes_received": s.get("bytesReceived", 0),
                "bytes_sent": s.get("bytesSent", 0)
            })
        return {"items": normalized}

    async def get_streams_summary(self):
        r = await self.client.get(f"{self.base_url}/paths/list")
        r.raise_for_status()
        data = r.json()
        items = data.get("items", []) or []

        def safe_int(val):
            if isinstance(val, int): return val
            if isinstance(val, list): return len(val)
            return 0

        online = sum(1 for s in items if s.get("ready"))
        return {
            "total": len(items),
            "online": online,
            "offline": len(items) - online,
            "total_readers": sum(safe_int(s.get("readers")) for s in items),
            "total_bytes_received": sum(s.get("bytesReceived", 0) for s in items),
            "total_bytes_sent": sum(s.get("bytesSent", 0) for s in items),
        }

    async def get_stream_detail(self, name):
        r = await self.client.get(f"{self.base_url}/paths/list")
        r.raise_for_status()
        data = r.json()
        items = data.get("items", []) or []
        s = next((s for s in items if s.get("name") == name), None)
        if not s:
            raise HTTPException(404, "Stream not found")
            
        return {
            "name": s.get("name"),
            "ready": s.get("ready"),
            "tracks": s.get("tracks") or [],
            "readers": len(s.get("readers", [])) if isinstance(s.get("readers"), list) else 0,
            "bytes_received": s.get("bytesReceived", 0),
            "bytes_sent": s.get("bytesSent", 0)
        }

    # --- Sessions ---
    async def list_sessions(self):
        sessions = []
        protocols = ["rtsp", "rtmp", "webrtc", "srt"]
        
        for proto in protocols:
            try:
                r = await self.client.get(f"{self.base_url}/{proto}/sessions/list")
                if r.status_code == 200:
                    items = r.json().get("items", []) or []
                    for s in items:
                        sessions.append({
                            "id": s.get("id"),
                            "type": proto,
                            "path": s.get("path"),
                            "remote_addr": s.get("remoteAddr"),
                            "bytes_received": s.get("bytesReceived", 0),
                            "bytes_sent": s.get("bytesSent", 0)
                        })
            except Exception:
                continue
        return {"items": sessions}

    async def kick_session(self, type, id):
        r = await self.client.post(f"{self.base_url}/{type}/sessions/kick/{id}")
        r.raise_for_status()
        return r.json()

    async def close(self):
        await self.client.aclose()

    # --- Path Defaults ---
    async def get_path_defaults(self):
        r = await self.client.get(f"{self.base_url}/config/path-defaults/get")
        r.raise_for_status()
        return r.json()

    async def patch_path_defaults(self, payload):
        r = await self.client.patch(
            f"{self.base_url}/config/pathDefaults/patch", json=payload
        )
        r.raise_for_status()
        return r.json()

    # --- Protocol Sessions/Connections ---
    async def list_hls_connections(self):
        try:
            r = await self.client.get(f"{self.base_url}/hls/connections/list")
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError:
            return {"items": []}

    async def list_rtsp_connections(self):
        try:
            r = await self.client.get(f"{self.base_url}/rtsp/connections/list")
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError:
            return {"items": []}

    async def list_rtmp_connections(self):
        try:
            r = await self.client.get(f"{self.base_url}/rtmp/connections/list")
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError:
            return {"items": []}

    async def list_hls_sessions(self):
        try:
            r = await self.client.get(f"{self.base_url}/hls/sessions/list")
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError:
            return {"items": []}

    async def list_rtsp_sessions(self):
        try:
            r = await self.client.get(f"{self.base_url}/rtsp/sessions/list")
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError:
            return {"items": []}

    async def list_rtmp_sessions(self):
        try:
            r = await self.client.get(f"{self.base_url}/rtmp/sessions/list")
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError:
            return {"items": []}

    # --- Metrics ---
    async def get_metrics(self):
        try:
            r = await self.client.get(f"{self.base_url}/metrics")
            r.raise_for_status()
            return r.text()
        except httpx.HTTPError:
            return ""

    # --- Logs ---
    # Log reading is handled directly in the backend via file I/O
    # This method is kept for interface compatibility but not used
    async def read_log_file(self, path, lines=100):
        return {"lines": [], "error": "Log reading not implemented in MediaMTX API"}
