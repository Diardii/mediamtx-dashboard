"""Kelola akun pengguna dashboard (khusus admin)."""

from fastapi import APIRouter, Depends

from .. import repos
from ..deps import require_admin
from ..errors import AppError
from ..responses import ok
from ..schemas import UserCreate, UserUpdate
from ..security import hash_password

router = APIRouter(prefix="/api/users", tags=["Users (admin)"], dependencies=[Depends(require_admin)])


@router.get("", summary="Daftar user")
async def list_users():
    items = repos.list_users()
    return ok(items, f"{len(items)} user")


@router.post("", status_code=201, summary="Tambah user")
async def create_user(body: UserCreate):
    user = repos.create_user(body.username, hash_password(body.password), body.role)
    return ok(user, f"User '{body.username}' dibuat")


@router.patch("/{username}", summary="Ubah password/peran user")
async def update_user(username: str, body: UserUpdate):
    target = repos.get_user(username)
    if not target:
        raise AppError(f"User '{username}' tidak ditemukan", 404)
    if body.role == "viewer" and target["role"] == "admin" and repos.count_admins() <= 1:
        raise AppError("Tidak bisa menurunkan admin terakhir", 400)
    user = repos.update_user(
        username,
        password_hash=hash_password(body.password) if body.password else None,
        role=body.role,
    )
    return ok(user, f"User '{username}' diperbarui")


@router.delete("/{username}", summary="Hapus user")
async def delete_user(username: str, me: dict = Depends(require_admin)):
    target = repos.get_user(username)
    if not target:
        raise AppError(f"User '{username}' tidak ditemukan", 404)
    if username == me["username"]:
        raise AppError("Tidak bisa menghapus akun sendiri", 400)
    if target["role"] == "admin" and repos.count_admins() <= 1:
        raise AppError("Tidak bisa menghapus admin terakhir", 400)
    repos.delete_user(username)
    return ok({"username": username}, f"User '{username}' dihapus")
