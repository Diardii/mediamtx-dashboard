"""Status dan konfigurasi server MediaMTX."""

from typing import Any

from fastapi import APIRouter, Body, Depends

from ..config import Settings, get_settings
from ..deps import get_client, require_admin
from ..mediamtx_client import MediaMTXError
from ..responses import ok

router = APIRouter(prefix="/api/server", tags=["Server"])


@router.get("/health", summary="Cek apakah MediaMTX bisa dihubungi (tanpa login)")
async def health(client=Depends(get_client), s: Settings = Depends(get_settings)):
    try:
        await client.get_global_config()
        return ok({"mediamtx": "online", "mock": s.use_mock}, "MediaMTX terhubung")
    except MediaMTXError as e:
        return ok({"mediamtx": "offline", "mock": s.use_mock, "error": e.message}, "MediaMTX tidak terhubung")


@router.get("/config", summary="Konfigurasi global MediaMTX (admin)")
async def get_config(client=Depends(get_client), _=Depends(require_admin)):
    # Admin saja: konfigurasi global bisa berisi password (authInternalUsers)
    return ok(await client.get_global_config())


@router.patch("/config", summary="Ubah konfigurasi global, berlaku tanpa restart (admin)")
async def patch_config(
    data: dict[str, Any] = Body(..., examples=[{"logLevel": "debug"}]),
    client=Depends(get_client),
    _=Depends(require_admin),
):
    await client.patch_global_config(data)
    return ok({"changed": list(data)}, "Konfigurasi diperbarui")
