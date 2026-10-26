"""Pengelolaan kamera (path MediaMTX) yang disimpan di database."""

from fastapi import APIRouter, Depends, Query

from .. import camera_service as svc
from .. import repos
from ..deps import get_client, get_current_user, require_admin
from ..errors import AppError
from ..responses import ok
from ..schemas import CameraCreate, CameraUpdate

router = APIRouter(prefix="/api/cameras", tags=["Cameras (pengelolaan)"])


@router.get("", summary="Daftar kamera + status di MediaMTX")
async def list_cameras(client=Depends(get_client), _=Depends(get_current_user)):
    items = await svc.list_with_status(client)
    return ok(items, f"{len(items)} kamera")


@router.post("", status_code=201, summary="Tambah kamera (admin)")
async def create_camera(body: CameraCreate, client=Depends(get_client), _=Depends(require_admin)):
    data = body.model_dump(exclude={"name"})
    cam = await svc.create(client, body.name, data)
    return ok(cam, f"Kamera '{body.name}' ditambahkan")


@router.post("/sync", summary="Daftarkan ulang kamera ke MediaMTX (admin)")
async def sync_cameras(
    full: bool = Query(False, description="true = samakan juga konfigurasi kamera yang sudah terdaftar"),
    client=Depends(get_client),
    _=Depends(require_admin),
):
    report = await svc.sync(client, full=full)
    return ok(report, f"{len(report['added'])} ditambah, {len(report['updated'])} diperbarui, "
                      f"{len(report['failed'])} gagal")


@router.get("/{name:path}", summary="Detail satu kamera")
async def get_camera(name: str, _=Depends(get_current_user)):
    cam = repos.get_camera(name)
    if not cam:
        raise AppError(f"Kamera '{name}' tidak ditemukan", 404)
    return ok(svc.public_view(cam))


@router.patch("/{name:path}", summary="Ubah kamera (admin)")
async def update_camera(name: str, body: CameraUpdate, client=Depends(get_client), _=Depends(require_admin)):
    data = body.model_dump(exclude_none=True)
    if not data:
        raise AppError("Tidak ada field yang diubah", 400)
    cam = await svc.update(client, name, data)
    return ok(cam, f"Kamera '{name}' diperbarui")


@router.delete("/{name:path}", summary="Hapus kamera (admin)")
async def delete_camera(name: str, client=Depends(get_client), _=Depends(require_admin)):
    await svc.delete(client, name)
    return ok({"name": name}, f"Kamera '{name}' dihapus")
