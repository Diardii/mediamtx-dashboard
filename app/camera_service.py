"""Logika kamera: database adalah sumber kebenaran, MediaMTX mengikuti.

Setiap perubahan kamera disimpan ke database lalu diterapkan ke MediaMTX.
Kalau MediaMTX menolak, perubahan di database dibatalkan supaya keduanya tetap sama.
Saat backend start (dan berkala), kamera yang hilang dari MediaMTX
(misalnya karena MediaMTX di-restart) didaftarkan ulang.
"""

import logging
import re

from . import repos
from .errors import AppError
from .mediamtx_client import MediaMTXError

log = logging.getLogger("camera_service")

_CRED_RE = re.compile(r"^([a-z0-9+.-]+://[^:/@]+):[^@]+@", re.IGNORECASE)


def mask_credentials(url):
    """rtsp://admin:rahasia@ip -> rtsp://admin:***@ip (agar password tidak tampil di browser)."""
    if isinstance(url, str):
        return _CRED_RE.sub(r"\1:***@", url)
    return url


_MASKED_RE = re.compile(r"^([a-z0-9+.-]+://[^:/@]+):\*\*\*@", re.IGNORECASE)
_PASS_RE = re.compile(r"^[a-z0-9+.-]+://[^:/@]+:([^@]+)@", re.IGNORECASE)


def restore_password(new_source: str, old_source: str) -> str:
    """Frontend mengirim password '***' jika tidak diubah; ganti dengan password tersimpan."""
    if not isinstance(new_source, str) or not _MASKED_RE.match(new_source):
        return new_source
    old = _PASS_RE.match(old_source or "")
    if not old:
        raise AppError("Isi password kamera.", 400)
    return _MASKED_RE.sub(lambda m: f"{m.group(1)}:{old.group(1)}@", new_source, count=1)


def is_online(p: dict) -> bool:
    # Versi MediaMTX berbeda bisa memakai "ready", "online", atau "available"
    for key in ("ready", "online", "available"):
        if key in p:
            return bool(p[key])
    return False


def _is_not_found(e: MediaMTXError) -> bool:
    return e.status_code == 404 or "not found" in e.message.lower()


def _is_exists(e: MediaMTXError) -> bool:
    return e.status_code in (400, 409) and "exist" in e.message.lower()


def to_mediamtx(cam: dict) -> dict:
    is_publisher = cam["source"] == "publisher"
    return {
        "source": cam["source"],
        "sourceOnDemand": bool(cam["source_on_demand"]) and not is_publisher,
        "record": bool(cam["record"]),
    }


def public_view(cam: dict) -> dict:
    out = dict(cam)
    out["source"] = mask_credentials(out["source"])
    return out


async def push(client, cam: dict, prefer_patch: bool = False) -> str:
    """Pastikan kamera terdaftar di MediaMTX sesuai database. Hasil: 'added' / 'updated'."""
    cfg = to_mediamtx(cam)
    if prefer_patch:
        try:
            await client.patch_config_path(cam["name"], cfg)
            return "updated"
        except MediaMTXError as e:
            if not _is_not_found(e):
                raise
        await client.add_config_path(cam["name"], cfg)
        return "added"

    try:
        await client.add_config_path(cam["name"], cfg)
        return "added"
    except MediaMTXError as e:
        if not _is_exists(e):
            raise
    await client.patch_config_path(cam["name"], cfg)
    return "updated"


async def pull(client, name: str) -> None:
    """Hapus kamera dari MediaMTX (abaikan jika memang tidak ada)."""
    try:
        await client.delete_config_path(name)
    except MediaMTXError as e:
        if not _is_not_found(e):
            raise


# ---------------- operasi yang dipakai router ----------------

async def list_with_status(client) -> list[dict]:
    cams = repos.list_cameras()
    try:
        runtime = {p["name"]: p for p in await client.list_paths()}
        reachable = True
    except MediaMTXError:
        runtime, reachable = {}, False

    out = []
    for cam in cams:
        p = runtime.get(cam["name"])
        item = public_view(cam)
        item["status"] = {
            "mediamtx_reachable": reachable,
            "registered": p is not None,
            "online": is_online(p) if p else False,
            "readers": len((p or {}).get("readers") or []),
        }
        out.append(item)
    return out


async def create(client, name: str, data: dict) -> dict:
    if _MASKED_RE.match(data.get("source") or ""):
        raise AppError("Isi password kamera.", 400)
    cam = repos.create_camera(name, data)
    if cam["enabled"]:
        try:
            await push(client, cam)
        except MediaMTXError:
            repos.delete_camera(name)  # batalkan
            raise
    return public_view(cam)


async def update(client, name: str, data: dict) -> dict:
    old = repos.get_camera(name)
    if not old:
        raise AppError(f"Kamera '{name}' tidak ditemukan", 404)
    if "source" in data:
        data = {**data, "source": restore_password(data["source"], old["source"])}
    new = repos.update_camera(name, data)
    try:
        if new["enabled"]:
            await push(client, new, prefer_patch=True)
        else:
            await pull(client, name)
    except MediaMTXError:
        repos.update_camera(name, {k: old[k] for k in data if k in old})  # batalkan
        raise
    return public_view(new)


async def delete(client, name: str) -> None:
    if not repos.get_camera(name):
        raise AppError(f"Kamera '{name}' tidak ditemukan", 404)
    await pull(client, name)
    repos.delete_camera(name)


async def sync(client, full: bool = False) -> dict:
    """Daftarkan kamera aktif yang belum ada di MediaMTX.

    full=True: kamera yang sudah ada juga disamakan konfigurasinya dengan database.
    """
    existing = {p["name"] for p in await client.list_config_paths()}
    report = {"added": [], "updated": [], "failed": []}
    for cam in repos.list_cameras():
        if not cam["enabled"]:
            continue
        if cam["name"] in existing and not full:
            continue
        try:
            result = await push(client, cam, prefer_patch=cam["name"] in existing)
            report[result].append(cam["name"])
        except MediaMTXError as e:
            report["failed"].append({"name": cam["name"], "error": e.message})
    return report
