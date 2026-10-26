"""Data tiruan dengan format yang meniru respons API MediaMTX v3.

Dipakai saat USE_MOCK=true, supaya backend bisa dikembangkan
tanpa MediaMTX berjalan. Perubahan (tambah/hapus path) disimpan
di memori dan hilang saat server dimatikan.
"""

import copy
from datetime import datetime, timezone

_NOW = datetime.now(timezone.utc).isoformat()

INFO = {"version": "v1.21.3", "started": _NOW}

GLOBAL_CONFIG = {
    "logLevel": "info",
    "api": True,
    "apiAddress": ":9997",
    "metrics": False,
    "rtsp": True,
    "rtspAddress": ":8554",
    "rtmp": True,
    "rtmpAddress": ":1935",
    "hls": True,
    "hlsAddress": ":8888",
    "webrtc": True,
    "webrtcAddress": ":8889",
    "srt": True,
    "srtAddress": ":8890",
    "rtspsAddress": ":8322",
    "rtmpsAddress": ":1936",
    "moq": True,
    "moqAddress": ":8892",
}

CONFIG_PATHS = {
    "test": {"name": "test", "source": "publisher", "record": False},
    "kamera-gerbang": {
        "name": "kamera-gerbang",
        "source": "rtsp://user:pass@192.168.1.10:554/stream1",
        "sourceOnDemand": True,
        "record": False,
    },
}

PATHS = {
    "test": {
        "name": "test",
        "confName": "test",
        "source": {"type": "rtspSession", "id": "a1b2c3d4"},
        "ready": True,
        "readyTime": _NOW,
        "tracks": ["H264"],
        "bytesReceived": 15_234_567,
        "bytesSent": 4_123_456,
        "readers": [{"type": "webRTCSession", "id": "w1x2y3z4"}],
    },
    "kamera-gerbang": {
        "name": "kamera-gerbang",
        "confName": "kamera-gerbang",
        "source": None,
        "ready": False,
        "readyTime": None,
        "tracks": [],
        "bytesReceived": 0,
        "bytesSent": 0,
        "readers": [],
    },
}

SESSIONS = {
    "rtspsessions": [
        {
            "id": "a1b2c3d4",
            "created": _NOW,
            "remoteAddr": "127.0.0.1:53210",
            "state": "publish",
            "path": "test",
            "transport": "TCP",
            "bytesReceived": 15_234_567,
            "bytesSent": 0,
        }
    ],
    "webrtcsessions": [
        {
            "id": "w1x2y3z4",
            "created": _NOW,
            "remoteAddr": "127.0.0.1:61234",
            "state": "read",
            "path": "test",
            "bytesReceived": 0,
            "bytesSent": 4_123_456,
        }
    ],
    "rtspconns": [
        {"id": "c1c2", "created": _NOW, "remoteAddr": "127.0.0.1:53210",
         "bytesReceived": 15_234_567, "bytesSent": 0, "session": "a1b2c3d4"}
    ],
    "rtmpconns": [],
    "srtconns": [],
    "moqsessions": [],
    "hlsmuxers": [
        {"path": "test", "created": _NOW, "lastRequest": _NOW, "bytesSent": 2_345_678}
    ],
    "recordings": [
        {"name": "test", "segments": [{"start": _NOW}]}
    ],
}


def fresh_state() -> dict:
    """Salinan baru agar tiap instance mock punya data sendiri."""
    return {
        "info": copy.deepcopy(INFO),
        "global": copy.deepcopy(GLOBAL_CONFIG),
        "config_paths": copy.deepcopy(CONFIG_PATHS),
        "paths": copy.deepcopy(PATHS),
        "sessions": copy.deepcopy(SESSIONS),
    }
