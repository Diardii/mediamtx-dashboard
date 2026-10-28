from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import os

from config import settings
from deps import get_mediamtx_client
from mediamtx_client import MediaMTXClient
from responses import StandardResponse


def read_log_file(path: str, lines: int = 100):
    """Read the last N lines from a log file."""
    try:
        if not os.path.exists(path):
            return {"lines": [], "error": f"Log file not found: {path}"}
        
        with open(path, 'r') as f:
            all_lines = f.readlines()
        
        # Get the last N lines
        last_lines = all_lines[-lines:] if len(all_lines) > lines else all_lines
        
        # Parse log lines (assuming JSON format or standard log format)
        parsed_lines = []
        for line in last_lines:
            line = line.strip()
            if not line:
                continue
            try:
                # Try to parse as JSON (MediaMTX structured logs)
                import json
                log_entry = json.loads(line)
                parsed_lines.append({
                    "timestamp": log_entry.get("time", ""),
                    "level": log_entry.get("level", ""),
                    "message": log_entry.get("msg", "")
                })
            except json.JSONDecodeError:
                # Fallback: treat as plain text
                parsed_lines.append({
                    "timestamp": "",
                    "level": "",
                    "message": line
                })
        
        return {"lines": parsed_lines, "error": None}
    except Exception as e:
        return {"lines": [], "error": str(e)}


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    MediaMTXClient.force_flush_sync()
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


# --- PATH DEFAULTS ROUTES ---

@app.get("/api/config/path-defaults")
async def get_path_defaults(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.get_path_defaults()
    return StandardResponse.success(data, "Path defaults retrieved")


@app.patch("/api/config/path-defaults")
async def patch_path_defaults(
    payload: dict, client: MediaMTXClient = Depends(get_mediamtx_client)
):
    data = await client.patch_path_defaults(payload)
    return StandardResponse.success(data, "Path defaults updated")


# --- RUNTIME ROUTES ---

@app.get("/api/runtime/hls/connections")
async def hls_connections(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.list_hls_connections()
    return StandardResponse.success(data, "HLS connections listed")


@app.get("/api/runtime/rtsp/connections")
async def rtsp_connections(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.list_rtsp_connections()
    return StandardResponse.success(data, "RTSP connections listed")


@app.get("/api/runtime/rtmp/connections")
async def rtmp_connections(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.list_rtmp_connections()
    return StandardResponse.success(data, "RTMP connections listed")


@app.get("/api/runtime/hls/sessions")
async def hls_sessions(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.list_hls_sessions()
    return StandardResponse.success(data, "HLS sessions listed")


@app.get("/api/runtime/rtsp/sessions")
async def rtsp_sessions(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.list_rtsp_sessions()
    return StandardResponse.success(data, "RTSP sessions listed")


@app.get("/api/runtime/rtmp/sessions")
async def rtmp_sessions(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.list_rtmp_sessions()
    return StandardResponse.success(data, "RTMP sessions listed")


@app.get("/api/metrics")
async def get_metrics(client: MediaMTXClient = Depends(get_mediamtx_client)):
    data = await client.get_metrics()
    return StandardResponse.success({"metrics": data}, "Metrics retrieved")


# --- LOGS ROUTES ---

@app.get("/api/logs")
async def read_logs(
    lines: int = Query(100, ge=1, le=5000)
):
    data = read_log_file(settings.LOG_FILE_PATH, lines)
    return StandardResponse.success(data, "Logs retrieved")


# --- FRONTEND ---

@app.get("/")
async def root():
    return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.API_HOST, port=settings.API_PORT)