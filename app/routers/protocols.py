"""Ringkasan server, halaman per protokol, dan daftar rekaman."""

from fastapi import APIRouter, Depends

from .. import protocol_service as svc
from ..deps import get_client, get_current_user
from ..errors import AppError
from ..responses import ok

router = APIRouter(prefix="/api", tags=["Protokol & ringkasan"], dependencies=[Depends(get_current_user)])


@router.get("/overview", summary="Ringkasan server: versi, protokol, path, kamera")
async def overview(client=Depends(get_client)):
    return ok(await svc.overview(client))


@router.get("/protocols", summary="Status semua protokol (aktif, port, jumlah koneksi)")
async def protocols(client=Depends(get_client)):
    return ok(await svc.protocols_summary(client))


@router.get("/protocols/{pid}", summary="Detail satu protokol: alamat dan daftar koneksi/sesi")
async def protocol_detail(pid: str, client=Depends(get_client)):
    if pid not in svc.PROTOCOLS:
        raise AppError(f"Protokol tidak dikenal. Pilihan: {', '.join(svc.PROTOCOLS)}", 404)
    return ok(await svc.protocol_detail(client, pid))


@router.get("/recordings", summary="Path yang punya rekaman")
async def recordings(client=Depends(get_client)):
    return ok(await svc.recordings(client))
