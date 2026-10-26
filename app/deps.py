"""Dependency bersama untuk router: client MediaMTX dan pengecekan login."""

from typing import Optional

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import repos
from .errors import AppError
from .security import decode_token

# auto_error=False supaya pesan error bisa dibuat sendiri (format { success, ... })
_bearer = HTTPBearer(auto_error=False, description="Tempel access_token dari /api/auth/login")


def get_client(request: Request):
    return request.app.state.mediamtx


def get_current_user(
    cred: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict:
    if cred is None:
        raise AppError("Belum login. Kirim header Authorization: Bearer <token>", 401)
    try:
        payload = decode_token(cred.credentials)
    except jwt.ExpiredSignatureError:
        raise AppError("Sesi login sudah habis, silakan login ulang", 401)
    except jwt.PyJWTError:
        raise AppError("Token tidak valid", 401)

    user = repos.get_user(payload.get("sub", ""))
    if not user:
        raise AppError("User tidak ditemukan", 401)
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise AppError("Hanya admin yang boleh melakukan ini", 403)
    return user
