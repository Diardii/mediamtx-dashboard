"""Login dan data user yang sedang login."""

from fastapi import APIRouter, Depends

from .. import repos
from ..deps import get_current_user
from ..errors import AppError
from ..responses import ok
from ..schemas import LoginRequest, PasswordChange
from ..security import create_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["Auth"])


@router.post("/login", summary="Login, mendapatkan access_token")
async def login(body: LoginRequest):
    user = repos.get_user(body.username, with_hash=True)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise AppError("Username atau password salah", 401)
    token, expires_in = create_token(user["username"], user["role"])
    user.pop("password_hash")
    return ok(
        {"access_token": token, "token_type": "bearer", "expires_in": expires_in, "user": user},
        "Login berhasil",
    )


@router.get("/me", summary="Data user yang sedang login")
async def me(user: dict = Depends(get_current_user)):
    return ok(user)


@router.post("/change-password", summary="Ganti password sendiri")
async def change_password(body: PasswordChange, user: dict = Depends(get_current_user)):
    full = repos.get_user(user["username"], with_hash=True)
    if not verify_password(body.old_password, full["password_hash"]):
        raise AppError("Password lama salah", 400)
    repos.update_user(user["username"], password_hash=hash_password(body.new_password))
    return ok(None, "Password diganti")
