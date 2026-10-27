import httpx
from fastapi import HTTPException
from config import settings
from schemas import (
    ServerHealthResponse,
    ServerConfigResponse,
    ServerConfigPatch,
    PathDetailResponse,
    PathListResponse,
    PathCreateRequest,
    PathPatchRequest,
    StreamListResponse,
    StreamSummaryResponse,
    StreamDetailResponse,
    SessionListResponse,
    SessionKickResponse,
)
from mock_data import load_mock_paths, load_mock_streams, load_mock_sessions


class MediaMTXClient:
    def __init__(self):
        base = str(settings.MEDIAMTX_API_URL).rstrip("/")
        self.base_url = f"{base}/v3"
        self.client = httpx.AsyncClient(timeout=10.0)

    # --- Server ---
    async def get_server_health(self) -> ServerHealthResponse:
        r = await self.client.get(f"{self.base_url}/server/health")
        r.raise_for_status()
        return ServerHealthResponse(**r.json())

    async def get_server_config(self) -> ServerConfigResponse:
        r = await self.client.get(f"{self.base_url}/server/config")
        r.raise_for_status()
        return ServerConfigResponse(**r.json())

    async def patch_server_config(self, payload: ServerConfigPatch) -> ServerConfigResponse:
        r = await self.client.patch(
            f"{self.base_url}/server/config",
            json=payload.model_dump(exclude_unset=True),
        )
        r.raise_for_status()
        return ServerConfigResponse(**r.json())

    # --- Paths ---
    async def list_paths(self) -> PathListResponse:
        r = await self.client.get(f"{self.base_url}/paths/list")
        r.raise_for_status()
        return PathListResponse(**r.json())

    async def create_path(self, name: str, source: str | None, source_on_demand: bool) -> PathDetailResponse:
        data = {"name": name, "source_on_demand": source_on_demand}
        if source:
            data["source"] = source
        r = await self.client.post(f"{self.base_url}/paths/add/{name}", json=data)
        r.raise_for_status()
        return PathDetailResponse(**r.json())

    async def get_path(self, name: str) -> PathDetailResponse:
        r = await self.client.get(f"{self.base_url}/paths/get/{name}")
        if r.status_code == 404:
            raise HTTPException(404, "Path not found")
        r.raise_for_status()
        return PathDetailResponse(**r.json())

    async def update_path(self, name: str, payload: PathPatchRequest) -> PathDetailResponse:
        r = await self.client.patch(
            f"{self.base_url}/paths/patch/{name}",
            json=payload.model_dump(exclude_unset=True),
        )
        if r.status_code == 404:
            raise HTTPException(404, "Path not found")
        r.raise_for_status()
        return PathDetailResponse(**r.json())

    async def delete_path(self, name: str) -> None:
        r = await self.client.delete(f"{self.base_url}/paths/delete/{name}")
        if r.status_code == 404:
            raise HTTPException(404, "Path not found")
        r.raise_for_status()

    # --- Streams ---
    async def list_streams(self) -> StreamListResponse:
        r = await self.client.get(f"{self.base_url}/streams/list")
        r.raise_for_status()
        return StreamListResponse(**r.json())

    async def get_streams_summary(self) -> StreamSummaryResponse:
        r = await self.client.get(f"{self.base_url}/streams/list")
        r.raise_for_status()
        data = StreamListResponse(**r.json())
        items = data.items
        online = sum(1 for s in items if s.ready)
        return StreamSummaryResponse(
            total=len(items),
            online=online,
            offline=len(items) - online,
            total_readers=sum(s.readers for s in items),
            total_bytes_received=sum(s.bytes_received for s in items),
            total_bytes_sent=sum(s.bytes_sent for s in items),
        )

    async def get_stream_detail(self, name: str) -> StreamDetailResponse:
        r = await self.client.get(f"{self.base_url}/streams/list")
        r.raise_for_status()
        data = StreamListResponse(**r.json())
        stream = next((s for s in data.items if s.name == name), None)
        if not stream:
            raise HTTPException(404, "Stream not found")
        return stream

    # --- Sessions ---
    async def list_sessions(self) -> SessionListResponse:
        r = await self.client.get(f"{self.base_url}/sessions/list")
        r.raise_for_status()
        return SessionListResponse(**r.json())

    async def kick_session(self, type: str, id: str) -> SessionKickResponse:
        r = await self.client.post(f"{self.base_url}/sessions/kick/{type}/{id}")
        r.raise_for_status()
        return SessionKickResponse(**r.json())

    async def close(self):
        await self.client.aclose()


class MockMediaMTXClient(MediaMTXClient):
    def __init__(self):
        self.paths = load_mock_paths()
        self.streams = load_mock_streams()
        self.sessions = load_mock_sessions()

    # --- Server ---
    async def get_server_health(self) -> ServerHealthResponse:
        return ServerHealthResponse(connected=True, version="1.0.0-mock")

    async def get_server_config(self) -> ServerConfigResponse:
        return ServerConfigResponse(api=True, log_level="info")

    async def patch_server_config(self, payload: ServerConfigPatch) -> ServerConfigResponse:
        return ServerConfigResponse(api=True, log_level=payload.log_level or "info")

    # --- Paths ---
    async def list_paths(self) -> PathListResponse:
        return PathListResponse(items=[PathDetailResponse(**p) for p in self.paths.values()])

    async def create_path(self, name: str, source: str | None, source_on_demand: bool) -> PathDetailResponse:
        if name in self.paths:
            raise HTTPException(409, "Path already exists")
        path = {
            "name": name,
            "source": source,
            "source_on_demand": source_on_demand,
            "source_redirect": "",
            "source_protocols": ["tcp", "udp"],
            "run_on_init": "",
            "run_on_init_restart": False,
            "fallback": "",
        }
        self.paths[name] = path
        return PathDetailResponse(**path)

    async def get_path(self, name: str) -> PathDetailResponse:
        if name not in self.paths:
            raise HTTPException(404, "Path not found")
        return PathDetailResponse(**self.paths[name])

    async def update_path(self, name: str, payload: PathPatchRequest) -> PathDetailResponse:
        if name not in self.paths:
            raise HTTPException(404, "Path not found")
        path = self.paths[name]
        if payload.source is not None:
            path["source"] = payload.source
        if payload.source_on_demand is not None:
            path["source_on_demand"] = payload.source_on_demand
        return PathDetailResponse(**path)

    async def delete_path(self, name: str) -> None:
        if name not in self.paths:
            raise HTTPException(404, "Path not found")
        del self.paths[name]

    # --- Streams ---
    async def list_streams(self) -> StreamListResponse:
        return StreamListResponse(items=[StreamDetailResponse(**s) for s in self.streams])

    async def get_streams_summary(self) -> StreamSummaryResponse:
        items = [StreamDetailResponse(**s) for s in self.streams]
        online = sum(1 for s in items if s.ready)
        return StreamSummaryResponse(
            total=len(items),
            online=online,
            offline=len(items) - online,
            total_readers=sum(s.readers for s in items),
            total_bytes_received=sum(s.bytes_received for s in items),
            total_bytes_sent=sum(s.bytes_sent for s in items),
        )

    async def get_stream_detail(self, name: str) -> StreamDetailResponse:
        stream = next((s for s in self.streams if s["name"] == name), None)
        if not stream:
            raise HTTPException(404, "Stream not found")
        return StreamDetailResponse(**stream)

    # --- Sessions ---
    async def list_sessions(self) -> SessionListResponse:
        return SessionListResponse(items=[SessionDetailResponse(**s) for s in self.sessions])

    async def kick_session(self, type: str, id: str) -> SessionKickResponse:
        session = next((s for s in self.sessions if s["id"] == id and s["type"] == type), None)
        if not session:
            raise HTTPException(404, "Session not found")
        self.sessions.remove(session)
        return SessionKickResponse(kicked=True)

    async def close(self):
        pass