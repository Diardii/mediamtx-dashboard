"""Penghubung ke API MediaMTX (v3).

Ada dua implementasi dengan method yang sama:
- MediaMTXClient : memanggil API MediaMTX sungguhan lewat HTTP
- MockClient     : memakai data tiruan di memori (USE_MOCK=true)
"""

from typing import Any

import httpx

from .config import Settings
from .mock_data import fresh_state

# Jenis koneksi/sesi yang bisa dilihat & diputus lewat API
SESSION_TYPES = ("rtspsessions", "rtspssessions", "webrtcsessions", "rtmpconns", "rtmpsconns", "srtconns", "moqsessions")


class MediaMTXError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class MediaMTXClient:
    def __init__(self, settings: Settings):
        auth = None
        if settings.mediamtx_api_user:
            auth = (settings.mediamtx_api_user, settings.mediamtx_api_pass)
        self._http = httpx.AsyncClient(
            base_url=settings.mediamtx_api_url.rstrip("/"),
            auth=auth,
            timeout=5.0,
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def _request(self, method: str, url: str, json: Any = None) -> Any:
        try:
            r = await self._http.request(method, url, json=json)
        except httpx.RequestError as e:
            raise MediaMTXError(
                f"MediaMTX tidak bisa dihubungi ({e.__class__.__name__}). "
                "Pastikan mediamtx.exe berjalan dan api: yes.",
                status_code=503,
            ) from e

        if r.status_code == 401:
            raise MediaMTXError("Ditolak MediaMTX (401). Cek user/password API di .env "
                                "atau authInternalUsers di mediamtx.yml.", 401)
        if r.status_code >= 400:
            try:
                detail = r.json().get("error", r.text)
            except ValueError:
                detail = r.text
            raise MediaMTXError(f"MediaMTX error: {detail}", r.status_code)

        if not r.content:
            return None
        return r.json()

    # ---------- server ----------
    async def get_info(self) -> dict:
        """Versi & waktu start MediaMTX (tidak tersedia di semua versi)."""
        return await self._request("GET", "/v3/info")

    async def get_global_config(self) -> dict:
        return await self._request("GET", "/v3/config/global/get")

    async def patch_global_config(self, data: dict) -> None:
        await self._request("PATCH", "/v3/config/global/patch", json=data)

    # ---------- path aktif (status runtime) ----------
    async def list_paths(self) -> list[dict]:
        res = await self._request("GET", "/v3/paths/list?itemsPerPage=1000")
        return res.get("items", [])

    async def get_path(self, name: str) -> dict:
        return await self._request("GET", f"/v3/paths/get/{name}")

    # ---------- konfigurasi path ----------
    async def list_config_paths(self) -> list[dict]:
        res = await self._request("GET", "/v3/config/paths/list?itemsPerPage=1000")
        return res.get("items", [])

    async def get_config_path(self, name: str) -> dict:
        return await self._request("GET", f"/v3/config/paths/get/{name}")

    async def add_config_path(self, name: str, data: dict) -> None:
        await self._request("POST", f"/v3/config/paths/add/{name}", json=data)

    async def patch_config_path(self, name: str, data: dict) -> None:
        await self._request("PATCH", f"/v3/config/paths/patch/{name}", json=data)

    async def delete_config_path(self, name: str) -> None:
        await self._request("DELETE", f"/v3/config/paths/delete/{name}")

    # ---------- sesi / koneksi / daftar lain ----------
    async def list_sessions(self, kind: str) -> list[dict]:
        """GET /v3/<kind>/list, misalnya rtspconns, hlsmuxers, recordings."""
        res = await self._request("GET", f"/v3/{kind}/list?itemsPerPage=1000")
        return res.get("items", [])

    async def kick_session(self, kind: str, session_id: str) -> None:
        await self._request("POST", f"/v3/{kind}/kick/{session_id}")


class MockClient:
    """Meniru MediaMTXClient tanpa jaringan."""

    def __init__(self, settings: Settings):
        self._s = fresh_state()

    async def close(self) -> None:
        pass

    async def get_info(self) -> dict:
        return dict(self._s["info"])

    async def get_global_config(self) -> dict:
        return dict(self._s["global"])

    async def patch_global_config(self, data: dict) -> None:
        self._s["global"].update(data)

    async def list_paths(self) -> list[dict]:
        return list(self._s["paths"].values())

    async def get_path(self, name: str) -> dict:
        if name not in self._s["paths"]:
            raise MediaMTXError("MediaMTX error: path not found", 404)
        return self._s["paths"][name]

    async def list_config_paths(self) -> list[dict]:
        return list(self._s["config_paths"].values())

    async def get_config_path(self, name: str) -> dict:
        if name not in self._s["config_paths"]:
            raise MediaMTXError("MediaMTX error: path configuration not found", 404)
        return self._s["config_paths"][name]

    async def add_config_path(self, name: str, data: dict) -> None:
        if name in self._s["config_paths"]:
            raise MediaMTXError("MediaMTX error: path already exists", 400)
        self._s["config_paths"][name] = {"name": name, **data}
        self._s["paths"][name] = {
            "name": name, "confName": name, "source": None, "ready": False,
            "readyTime": None, "tracks": [], "bytesReceived": 0, "bytesSent": 0, "readers": [],
        }

    async def patch_config_path(self, name: str, data: dict) -> None:
        cfg = await self.get_config_path(name)
        cfg.update(data)

    async def delete_config_path(self, name: str) -> None:
        await self.get_config_path(name)
        del self._s["config_paths"][name]
        self._s["paths"].pop(name, None)

    async def list_sessions(self, kind: str) -> list[dict]:
        return list(self._s["sessions"].get(kind, []))

    async def kick_session(self, kind: str, session_id: str) -> None:
        items = self._s["sessions"].get(kind, [])
        for i, s in enumerate(items):
            if s["id"] == session_id:
                del items[i]
                return
        raise MediaMTXError("MediaMTX error: session not found", 404)


def build_client(settings: Settings):
    return MockClient(settings) if settings.use_mock else MediaMTXClient(settings)

