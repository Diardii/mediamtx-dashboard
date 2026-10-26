"""Ringkasan per protokol MediaMTX (RTSP, RTMP, SRT, WebRTC, HLS, MoQ).

Setiap protokol punya: saklar aktif di konfigurasi global, alamat (port),
dan satu atau lebih daftar runtime di API MediaMTX (/v3/<list>/list).
Daftar yang tidak dikenal versi MediaMTX yang dipakai ditandai "available": false.
"""

import asyncio
from typing import Optional

from . import camera_service, repos
from .mediamtx_client import MediaMTXError

# label: nama daftar untuk ditampilkan di dashboard
# kick: daftar yang item-nya bisa diputus lewat API
PROTOCOLS = {
    "rtsp": {
        "title": "RTSP",
        "enable_key": "rtsp",
        "addresses": {"rtspAddress": "RTSP", "rtspsAddress": "RTSPS"},
        "lists": {
            "rtspsessions": {"label": "Sesi RTSP", "kick": True},
            "rtspconns": {"label": "Koneksi RTSP", "kick": False},
            "rtspssessions": {"label": "Sesi RTSPS", "kick": True},
            "rtspsconns": {"label": "Koneksi RTSPS", "kick": False},
        },
    },
    "rtmp": {
        "title": "RTMP",
        "enable_key": "rtmp",
        "addresses": {"rtmpAddress": "RTMP", "rtmpsAddress": "RTMPS"},
        "lists": {
            "rtmpconns": {"label": "Koneksi RTMP", "kick": True},
            "rtmpsconns": {"label": "Koneksi RTMPS", "kick": True},
        },
    },
    "srt": {
        "title": "SRT",
        "enable_key": "srt",
        "addresses": {"srtAddress": "SRT"},
        "lists": {"srtconns": {"label": "Koneksi SRT", "kick": True}},
    },
    "webrtc": {
        "title": "WebRTC",
        "enable_key": "webrtc",
        "addresses": {"webrtcAddress": "HTTP"},
        "lists": {"webrtcsessions": {"label": "Sesi WebRTC", "kick": True}},
    },
    "hls": {
        "title": "HLS",
        "enable_key": "hls",
        "addresses": {"hlsAddress": "HTTP"},
        "lists": {"hlsmuxers": {"label": "Muxer HLS", "kick": False}},
    },
    "moq": {
        "title": "MoQ",
        "enable_key": "moq",
        "addresses": {"moqAddress": "MoQ"},
        "lists": {"moqsessions": {"label": "Sesi MoQ", "kick": False}},
    },
}


async def _fetch_list(client, name: str) -> dict:
    try:
        return {"available": True, "items": await client.list_sessions(name)}
    except MediaMTXError as e:
        if e.status_code in (400, 404, 405):
            return {"available": False, "items": []}
        raise


async def _global_safe(client) -> Optional[dict]:
    try:
        return await client.get_global_config()
    except MediaMTXError:
        return None


def _config_part(pid: str, glob: Optional[dict]) -> dict:
    """Hanya ambil saklar & alamat. Konfigurasi global utuh bisa berisi password."""
    p = PROTOCOLS[pid]
    if glob is None:
        return {"enabled": None, "addresses": []}
    enabled = glob.get(p["enable_key"])
    addresses = [
        {"label": label, "address": glob[key]}
        for key, label in p["addresses"].items()
        if glob.get(key)
    ]
    return {"enabled": enabled if isinstance(enabled, bool) else None, "addresses": addresses}


async def protocol_detail(client, pid: str) -> dict:
    p = PROTOCOLS[pid]
    glob = await _global_safe(client)
    names = list(p["lists"])
    results = await asyncio.gather(*(_fetch_list(client, n) for n in names))
    lists = {}
    for n, r in zip(names, results):
        if not r["available"] and n.startswith(("rtsps", "rtmps")):
            continue  # varian terenkripsi yang tidak ada di versi ini: sembunyikan
        lists[n] = {**p["lists"][n], **r}
    return {"id": pid, "title": p["title"], **_config_part(pid, glob), "lists": lists}


async def protocols_summary(client) -> list[dict]:
    glob = await _global_safe(client)
    all_lists = [(pid, n) for pid, p in PROTOCOLS.items() for n in p["lists"]]
    results = await asyncio.gather(*(_fetch_list(client, n) for _, n in all_lists), return_exceptions=True)

    counts: dict[str, dict] = {pid: {"active": 0, "available": False} for pid in PROTOCOLS}
    for (pid, _), r in zip(all_lists, results):
        if isinstance(r, Exception) or not r["available"]:
            continue
        counts[pid]["available"] = True
        counts[pid]["active"] += len(r["items"])

    return [
        {"id": pid, "title": p["title"], **_config_part(pid, glob), **counts[pid]}
        for pid, p in PROTOCOLS.items()
    ]


async def overview(client) -> dict:
    try:
        info = await client.get_info()
    except MediaMTXError as e:
        info = None
        if e.status_code in (503, 401):
            return {
                "mediamtx_reachable": False, "error": e.message, "info": None,
                "protocols": [], "paths": {"total": 0, "online": 0, "readers": 0},
                "cameras": _camera_counts([]),
            }

    try:
        paths = await client.list_paths()
        reachable = True
    except MediaMTXError:
        paths, reachable = [], False

    online_names = {p["name"] for p in paths if camera_service.is_online(p)}
    cams = repos.list_cameras()
    return {
        "mediamtx_reachable": reachable,
        "info": info,
        "protocols": await protocols_summary(client) if reachable else [],
        "paths": {
            "total": len(paths),
            "online": len(online_names),
            "readers": sum(len(p.get("readers") or []) for p in paths),
        },
        "cameras": _camera_counts(cams, online_names),
    }


def _camera_counts(cams: list[dict], online_names: Optional[set] = None) -> dict:
    online_names = online_names or set()
    return {
        "total": len(cams),
        "live": sum(1 for c in cams if c["name"] in online_names),
        "disabled": sum(1 for c in cams if not c["enabled"]),
    }


async def recordings(client) -> dict:
    r = await _fetch_list(client, "recordings")
    return r
