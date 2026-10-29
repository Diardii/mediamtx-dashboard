from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import httpx
from fastapi import HTTPException
from config import settings
from responses import StandardResponse


_SENSITIVE_QUERY_KEYS = {
    "access_token",
    "apikey",
    "api_key",
    "authorization",
    "auth",
    "password",
    "passwd",
    "refresh_token",
    "secret",
    "token",
}


def _mask_sensitive_url(value):
    if not isinstance(value, str):
        return value

    parts = urlsplit(value)
    netloc = parts.netloc
    if "@" in netloc:
        netloc = f"***:***@{netloc.rsplit('@', 1)[1]}"

    query = []
    for key, item in parse_qsl(parts.query, keep_blank_values=True):
        normalized_key = key.lower().replace("-", "_")
        sensitive = normalized_key in _SENSITIVE_QUERY_KEYS or any(
            marker in normalized_key for marker in ("token", "password", "passwd", "secret", "authorization", "apikey")
        )
        query.append((key, "***" if sensitive else item))
    return urlunsplit((parts.scheme, netloc, parts.path, urlencode(query), parts.fragment))


def _mask_path_config(config):
    if not isinstance(config, dict):
        return config

    safe_config = dict(config)
    for key in ("source", "sourceRedirect", "fallback"):
        if key in safe_config:
            safe_config[key] = _mask_sensitive_url(safe_config[key])
    return safe_config


class MediaMTXClient:
    def __init__(self):
        base = str(settings.MEDIAMTX_API_URL).rstrip("/")
        self.base_url = f"{base}/v3"
        self.client = httpx.AsyncClient(timeout=10.0)

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
        return r.json()

    # --- Paths ---
    async def list_paths(self):
        r = await self.client.get(f"{self.base_url}/config/paths/list")
        r.raise_for_status()
        data = r.json()
        if isinstance(data, dict) and isinstance(data.get("items"), list):
            data["items"] = [_mask_path_config(item) for item in data["items"]]
        return data

    async def create_path(self, name, source, source_on_demand, **kwargs):
        data = {}
        if source:
            data["source"] = source
            # sourceOnDemand applies to URL sources; sending it for publisher
            # and redirect paths can make MediaMTX reject the configuration.
            if source_on_demand is not None:
                data["sourceOnDemand"] = source_on_demand
        elif kwargs.get("source_redirect"):
            data["source"] = "redirect"
        # Optional fields
        if kwargs.get("source_on_demand_start_timeout"):
            data["sourceOnDemandStartTimeout"] = kwargs["source_on_demand_start_timeout"]
        if kwargs.get("source_on_demand_close_after"):
            data["sourceOnDemandCloseAfter"] = kwargs["source_on_demand_close_after"]
        if kwargs.get("max_readers") is not None:
            data["maxReaders"] = kwargs["max_readers"]
        if kwargs.get("fallback"):
            data["fallback"] = kwargs["fallback"]
        if kwargs.get("source_redirect"):
            data["sourceRedirect"] = kwargs["source_redirect"]
        r = await self.client.post(f"{self.base_url}/config/paths/add/{name}", json=data)
        r.raise_for_status()
        return r.json()

    async def get_path(self, name):
        r = await self.client.get(f"{self.base_url}/config/paths/get/{quote(name, safe='')}")
        if r.status_code == 404:
            raise HTTPException(404, "Path not found")
        r.raise_for_status()
        return _mask_path_config(r.json())

    async def update_path(self, name, payload):
        # Map frontend field names to MediaMTX API field names
        mapped = {}
        field_map = {
            "source": "source",
            "source_on_demand": "sourceOnDemand",
            "source_on_demand_start_timeout": "sourceOnDemandStartTimeout",
            "source_on_demand_close_after": "sourceOnDemandCloseAfter",
            "max_readers": "maxReaders",
            "fallback": "fallback",
            "source_redirect": "sourceRedirect",
        }
        for key, value in payload.items():
            if key in field_map and value is not None:
                mapped[field_map[key]] = value
        r = await self.client.patch(
            f"{self.base_url}/config/paths/patch/{quote(name, safe='')}",
            json=mapped,
        )
        if r.status_code == 404:
            raise HTTPException(404, "Path not found")
        r.raise_for_status()
        return r.json()

    async def delete_path(self, name):
        r = await self.client.delete(f"{self.base_url}/config/paths/delete/{quote(name, safe='')}")
        if r.status_code == 404:
            raise HTTPException(404, "Path not found")
        r.raise_for_status()

    # --- Streams ---
    async def list_streams(self):
        r = await self.client.get(f"{self.base_url}/paths/list")
        r.raise_for_status()
        return r.json()

    async def get_streams_summary(self):
        r = await self.client.get(f"{self.base_url}/paths/list")
        r.raise_for_status()
        data = r.json()
        items = data.get("items", []) or []

        def safe_int(val):
            if isinstance(val, int):
                return val
            if isinstance(val, (list, dict)):
                return 0
            try:
                return int(val)
            except Exception:
                return 0

        online = sum(1 for s in items if s.get("ready"))
        return {
            "total": len(items),
            "online": online,
            "offline": len(items) - online,
            "total_readers": sum(safe_int(s.get("readers", 0)) for s in items),
            "total_bytes_received": sum(safe_int(s.get("bytes_received", 0)) for s in items),
            "total_bytes_sent": sum(safe_int(s.get("bytes_sent", 0)) for s in items),
        }

    async def get_stream_detail(self, name):
        r = await self.client.get(f"{self.base_url}/paths/get/{quote(name, safe='')}")
        r.raise_for_status()
        stream = r.json()
        if not isinstance(stream, dict) or stream.get("name") != name:
            raise HTTPException(404, "Stream not found")
        return stream

    # --- Sessions ---
    async def list_sessions(self):
        try:
            r = await self.client.get(f"{self.base_url}/rtsp/sessions/list")
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError:
            return {"items": []}

    async def kick_session(self, type, id):
        # MediaMTX uses different endpoints for different protocols
        # Connections vs Sessions endpoints vary by protocol
        endpoint_map = {
            "rtsp": "rtsp/sessions/kick",
            "rtsps": "rtsp/sessions/kick",
            "rtmp": "rtmp/sessions/kick",
            "rtmps": "rtmp/sessions/kick",
            "hls": "hls/connections/kick",
            "webrtc": "webrtc/sessions/kick",
            "srt": "srt/sessions/kick",
            "moq": "moq/sessions/kick",
        }
        endpoint = endpoint_map.get(type.lower(), f"{type}/sessions/kick")
        r = await self.client.post(f"{self.base_url}/{endpoint}/{id}")
        r.raise_for_status()
        return r.json()

    async def list_all_sessions(self):
        """Fetch sessions/connections from all available protocols and normalize."""
        protocols = [
            ("rtsp", "rtsp/sessions/list"),
            ("rtsps", "rtsp/sessions/list"),
            ("rtmp", "rtmp/sessions/list"),
            ("rtmps", "rtmp/sessions/list"),
            ("hls", "hls/sessions/list"),
            ("webrtc", "webrtc/sessions/list"),
            ("srt", "srt/sessions/list"),
            ("moq", "moq/sessions/list"),
        ]
        
        all_sessions = []
        for proto, endpoint in protocols:
            try:
                r = await self.client.get(f"{self.base_url}/{endpoint}")
                if r.status_code == 404:
                    # Endpoint not available in this MediaMTX version
                    continue
                r.raise_for_status()
                data = r.json()
                items = data.get("items", []) or []
                for item in items:
                    normalized = self._normalize_session(item, proto)
                    if normalized:
                        all_sessions.append(normalized)
            except httpx.HTTPError:
                # Protocol endpoint not available or error, skip
                continue
        
        return {"items": all_sessions}

    def _normalize_session(self, item, proto):
        """Normalize session/connection item from any protocol to common schema."""
        # MediaMTX returns different field names across protocols
        # Common fields: id, path, remoteAddr/remote_addr, bytesReceived/bytes_received, bytesSent/bytes_sent, ready
        session_id = item.get("id") or item.get("ID")
        if not session_id:
            return None
        
        path = item.get("path") or item.get("Path") or "-"
        remote_addr = item.get("remoteAddr") or item.get("remote_addr") or item.get("RemoteAddr") or "-"
        bytes_received = item.get("bytesReceived") or item.get("bytes_received") or item.get("BytesReceived") or 0
        bytes_sent = item.get("bytesSent") or item.get("bytes_sent") or item.get("BytesSent") or 0
        ready = item.get("ready") or item.get("Ready") or False
        
        return {
            "id": session_id,
            "type": proto,
            "path": path,
            "remote_addr": remote_addr,
            "bytes_received": bytes_received,
            "bytes_sent": bytes_sent,
            "ready": ready,
        }

    async def close(self):
        await self.client.aclose()

    # --- Path Defaults ---
    async def get_path_defaults(self):
        r = await self.client.get(f"{self.base_url}/config/path-defaults/get")
        r.raise_for_status()
        return r.json()

    async def patch_path_defaults(self, payload):
        r = await self.client.patch(
            f"{self.base_url}/config/path-defaults/patch", json=payload
        )
        r.raise_for_status()
        return r.json()

    # --- Protocol Sessions/Connections ---
    async def list_hls_connections(self):
        try:
            r = await self.client.get(f"{self.base_url}/hls/conns/list")
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError:
            return {"items": []}

    async def list_rtsp_connections(self):
        try:
            r = await self.client.get(f"{self.base_url}/rtsp/conns/list")
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError:
            return {"items": []}

    async def list_rtmp_connections(self):
        try:
            r = await self.client.get(f"{self.base_url}/rtmp/conns/list")
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
