import httpx
from fastapi import HTTPException
from config import settings
from responses import StandardResponse


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
        return r.json()

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
        r = await self.client.get(f"{self.base_url}/config/paths/get/{name}")
        if r.status_code == 404:
            raise HTTPException(404, "Path not found")
        r.raise_for_status()
        return r.json()

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
            f"{self.base_url}/config/paths/patch/{name}",
            json=mapped,
        )
        if r.status_code == 404:
            raise HTTPException(404, "Path not found")
        r.raise_for_status()
        return r.json()

    async def delete_path(self, name):
        r = await self.client.delete(f"{self.base_url}/config/paths/delete/{name}")
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
        r = await self.client.get(f"{self.base_url}/paths/list")
        r.raise_for_status()
        data = r.json()
        items = data.get("items", []) or []
        stream = next((s for s in items if s.get("name") == name), None)
        if not stream:
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
