"""Hash password dan token login (JWT).

Hash password memakai PBKDF2-SHA256 dari pustaka standar Python,
jadi tidak perlu paket yang harus di-compile di Windows.
"""

import base64
import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone

import jwt

log = logging.getLogger("security")

_ITERATIONS = 390_000
_secret_key = ""
_expire_minutes = 480


def configure(secret_key: str, expire_minutes: int) -> None:
    global _secret_key, _expire_minutes
    if not secret_key:
        secret_key = secrets.token_hex(32)
        log.warning("SECRET_KEY kosong di .env, memakai kunci acak. "
                    "Semua user harus login ulang setiap backend di-restart.")
    _secret_key = secret_key
    _expire_minutes = expire_minutes


# ---------------- password ----------------

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return "pbkdf2_sha256${}${}${}".format(
        _ITERATIONS,
        base64.b64encode(salt).decode(),
        base64.b64encode(dk).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_b64, hash_b64 = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt_b64), int(iterations))
        return hmac.compare_digest(dk, base64.b64decode(hash_b64))
    except (ValueError, TypeError):
        return False


# ---------------- token ----------------

def create_token(username: str, role: str) -> tuple[str, int]:
    expires_in = _expire_minutes * 60
    now = datetime.now(timezone.utc)
    payload = {"sub": username, "role": role, "iat": now, "exp": now + timedelta(seconds=expires_in)}
    return jwt.encode(payload, _secret_key, algorithm="HS256"), expires_in


def decode_token(token: str) -> dict:
    """Mengembalikan payload, atau melempar jwt.PyJWTError jika token tidak sah/kedaluwarsa."""
    return jwt.decode(token, _secret_key, algorithms=["HS256"])
