from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from config import settings
from deps import get_mediamtx_client
from mediamtx_client import MediaMTXClient
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
from responses import StandardResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    client = get_mediamtx_client()
    await client.close()


app = FastAPI(title="MediaMTX Dashboard", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")


# --- SERVER ROUTES ---

@app.get("/api/server/health", response_model=StandardResponse[ServerHealthResponse])
async def server_health(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.get_server_health()
    return StandardResponse.success(data, "MediaMTX health status")


@app.get("/api/server/config", response_model=StandardResponse[ServerConfigResponse])
async def server_config(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.get_server_config()
    return StandardResponse.success(data, "MediaMTX configuration")


@app.patch("/api/server/config", response_model=StandardResponse[ServerConfigResponse])
async def patch_server_config(
    payload: ServerConfigPatch, client: MediaMTXClient = Depends(get_mediamtx_client)
):
    data = await client.patch_server_config(payload)
    return StandardResponse.success(data, "Configuration updated")


# --- PATHS ROUTES ---

@app.get("/api/paths", response_model=StandardResponse[PathListResponse])
async def list_paths(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.list_paths()
    return StandardResponse.success(data, f"{len(data.items)} paths")


@app.post("/api/paths", response_model=StandardResponse[PathDetailResponse])
async def create_path(
    payload: PathCreateRequest, client: MediaMTXClient = Depends(get_mediamtx_client)
):
    data = await client.create_path(payload.name, payload.source, payload.source_on_demand)
    return StandardResponse.success(data, "Path created")


@app.get("/api/paths/{name}", response_model=StandardResponse[PathDetailResponse])
async def get_path(name: str, client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.get_path(name)
    return StandardResponse.success(data, "Path details")


@app.patch("/api/paths/{name}", response_model=StandardResponse[PathDetailResponse])
async def update_path(
    name: str, payload: PathPatchRequest, client: MediaMTXClient = Depends(get_mediamtx_client)
):
    data = await client.update_path(name, payload)
    return StandardResponse.success(data, "Path updated")


@app.delete("/api/paths/{name}", response_model=StandardResponse[None])
async def delete_path(name: str, client: MediaMTXClient = Depends(get_mediamtx_client)):
    await client.delete_path(name)
    return StandardResponse.success(None, "Path deleted")


# --- STREAMS ROUTES ---

@app.get("/api/streams", response_model=StandardResponse[StreamListResponse])
async def list_streams(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.list_streams()
    return StandardResponse.success(data, f"{len(data.items)} streams")


@app.get("/api/streams/summary", response_model=StandardResponse[StreamSummaryResponse])
async def streams_summary(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.get_streams_summary()
    return StandardResponse.success(data, "Streams summary")


@app.get("/api/streams/{name}", response_model=StandardResponse[StreamDetailResponse])
async def stream_detail(name: str, client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.get_stream_detail(name)
    return StandardResponse.success(data, "Stream details")


# --- SESSIONS ROUTES ---

@app.get("/api/sessions", response_model=StandardResponse[SessionListResponse])
async def list_sessions(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.list_sessions()
    return StandardResponse.success(data, f"{len(data.items)} sessions")


@app.post(
    "/api/sessions/{type}/{id}/kick", response_model=StandardResponse[SessionKickResponse]
)
async def kick_session(
    type: str, id: str, client: MediaMTXClient = Depends(get_mediamtx_client)
):
    data = await client.kick_session(type, id)
    return StandardResponse.success(data, "Session kicked")


# --- FRONTEND ---

@app.get("/")
async def root():
    return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.API_HOST, port=settings.API_PORT)