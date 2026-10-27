from typing import Optional
from pydantic import BaseModel, field_validator


# --- Common ---

class StandardResponse(BaseModel):
    success: bool
    data: Optional[object] = None
    message: str = ""


# --- Server ---

class ServerHealthResponse(BaseModel):
    connected: bool
    version: str


class ServerConfigResponse(BaseModel):
    # MediaMTX global config fields (subset)
    api: Optional[bool] = None
    log_level: Optional[str] = None
    # Add more as needed


class ServerConfigPatch(BaseModel):
    log_level: Optional[str] = None
    # Add more mutable fields as needed


# --- Paths ---

class PathCreateRequest(BaseModel):
    name: str
    source: Optional[str] = None
    source_on_demand: bool = True


class PathPatchRequest(BaseModel):
    source: Optional[str] = None
    source_on_demand: Optional[bool] = None


class PathDetailResponse(BaseModel):
    name: str
    source: Optional[str] = None
    source_on_demand: bool = True
    # Additional fields from MediaMTX
    source_redirect: Optional[str] = None
    source_protocols: Optional[list[str]] = None
    run_on_init: Optional[str] = None
    run_on_init_restart: Optional[bool] = None
    fallback: Optional[str] = None

    @field_validator("source", mode="before")
    @classmethod
    def mask_password(cls, v: Optional[str]) -> Optional[str]:
        if v and "@" in v and "://" in v:
            # rtsp://user:pass@host -> rtsp://user:***@host
            parts = v.split("@")
            if len(parts) == 2:
                auth = parts[0]
                if ":" in auth:
                    user = auth.split(":")[0]
                    return f"{user}:***@{parts[1]}"
        return v


class PathListResponse(BaseModel):
    items: list[PathDetailResponse]


# --- Streams ---

class StreamDetailResponse(BaseModel):
    name: str
    ready: bool
    tracks: list[dict] = []
    readers: int = 0
    bytes_received: int = 0
    bytes_sent: int = 0


class StreamListResponse(BaseModel):
    items: list[StreamDetailResponse]


class StreamSummaryResponse(BaseModel):
    total: int
    online: int
    offline: int
    total_readers: int
    total_bytes_received: int
    total_bytes_sent: int


# --- Sessions ---

class SessionDetailResponse(BaseModel):
    id: str
    type: str  # rtsp, rtmp, hls, webrtc, srt
    path: str
    remote_addr: str
    bytes_received: int = 0
    bytes_sent: int = 0


class SessionListResponse(BaseModel):
    items: list[SessionDetailResponse]


class SessionKickResponse(BaseModel):
    kicked: bool