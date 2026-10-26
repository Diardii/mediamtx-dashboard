"""Monitoring stream: status online/offline, penonton, trafik."""

from fastapi import APIRouter, Depends

from .. import repos
from ..camera_service import is_online
from ..config import Settings, get_settings
from ..deps import get_client, get_current_user
from ..responses import ok
from ..schemas import StreamSummary

router = APIRouter(
    prefix="/api/streams",
    tags=["Streams (monitoring)"],
    dependencies=[Depends(get_current_user)],
)


def _summarize(p: dict, s: Settings, cams: dict) -> StreamSummary:
    name = p["name"]
    cam = cams.get(name) or {}
    src = p.get("source") or {}
    tracks = [t if isinstance(t, str) else t.get("codec", "?") for t in (p.get("tracks") or [])]
    return StreamSummary(
        name=name,
        label=cam.get("label") or None,
        location=cam.get("location") or None,
        online=is_online(p),
        source_type=src.get("type"),
        tracks=tracks,
        readers=len(p.get("readers") or []),
        bytes_received=p.get("bytesReceived", 0),
        bytes_sent=p.get("bytesSent", 0),
        online_since=p.get("readyTime") or p.get("onlineTime") or p.get("availableTime"),
        urls={
            "webrtc": f"{s.mediamtx_webrtc_url.rstrip('/')}/{name}",
            "hls": f"{s.mediamtx_hls_url.rstrip('/')}/{name}",
            "rtsp": f"{s.mediamtx_rtsp_url.rstrip('/')}/{name}",
        },
    )


@router.get("", summary="Daftar semua stream beserta statusnya")
async def list_streams(client=Depends(get_client), s: Settings = Depends(get_settings)):
    cams = {c["name"]: c for c in repos.list_cameras()}
    items = [_summarize(p, s, cams) for p in await client.list_paths()]
    return ok(items, f"{len(items)} stream")


@router.get("/summary", summary="Angka ringkas untuk kartu statistik dashboard")
async def streams_summary(client=Depends(get_client)):
    paths = await client.list_paths()
    online = sum(1 for p in paths if is_online(p))
    return ok({
        "total": len(paths),
        "online": online,
        "offline": len(paths) - online,
        "viewers": sum(len(p.get("readers") or []) for p in paths),
        "bytes_received": sum(p.get("bytesReceived", 0) for p in paths),
        "bytes_sent": sum(p.get("bytesSent", 0) for p in paths),
    })


@router.get("/{name:path}", summary="Detail satu stream")
async def get_stream(name: str, client=Depends(get_client), s: Settings = Depends(get_settings)):
    p = await client.get_path(name)
    cam = repos.get_camera(name)
    return ok({"summary": _summarize(p, s, {name: cam} if cam else {}), "raw": p})
