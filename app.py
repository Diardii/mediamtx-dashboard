from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from config import settings
from deps import get_mediamtx_client
from mediamtx_client import MediaMTXClient
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

@app.get("/api/server/health")
async def server_health(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.get_server_health()
    return StandardResponse.success(data, "MediaMTX health status")


@app.get("/api/server/config")
async def server_config(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.get_server_config()
    return StandardResponse.success(data, "MediaMTX configuration")


@app.patch("/api/server/config")
async def patch_server_config(
    payload: dict, client: MediaMTXClient = Depends(get_mediamtx_client)
):
    data = await client.patch_server_config(payload)
    return StandardResponse.success(data, "Configuration updated")


# --- PATHS ROUTES ---

@app.get("/api/paths")
async def list_paths(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.list_paths()
    return StandardResponse.success(data, "Paths listed")


@app.post("/api/paths")
async def create_path(
    payload: dict, client: MediaMTXClient = Depends(get_mediamtx_client)
):
    data = await client.create_path(payload.get("name"), payload.get("source"), payload.get("source_on_demand", True))
    return StandardResponse.success(data, "Path created")


@app.get("/api/paths/{name}")
async def get_path(name: str, client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.get_path(name)
    return StandardResponse.success(data, "Path details")


@app.patch("/api/paths/{name}")
async def update_path(
    name: str, payload: dict, client: MediaMTXClient = Depends(get_mediamtx_client)
):
    data = await client.update_path(name, payload)
    return StandardResponse.success(data, "Path updated")


@app.delete("/api/paths/{name}")
async def delete_path(name: str, client: MediaMTXClient = Depends(get_mediamtx_client)):
    await client.delete_path(name)
    return StandardResponse.success(None, "Path deleted")


# --- STREAMS ROUTES ---

@app.get("/api/streams")
async def list_streams(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.list_streams()
    return StandardResponse.success(data, "Streams listed")


@app.get("/api/streams/summary")
async def streams_summary(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.get_streams_summary()
    return StandardResponse.success(data, "Streams summary")


@app.get("/api/streams/{name}")
async def stream_detail(name: str, client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.get_stream_detail(name)
    return StandardResponse.success(data, "Stream details")


# --- SESSIONS ROUTES ---

@app.get("/api/sessions")
async def list_sessions(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.list_sessions()
    return StandardResponse.success(data, "Sessions listed")


@app.post(
    "/api/sessions/{type}/{id}/kick"
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