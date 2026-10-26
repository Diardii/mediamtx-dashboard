"""Model data untuk request dan respons dashboard."""

import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

# Nama path MediaMTX: huruf, angka, - _ . ~ dan / (untuk sub-path)
_NAME_RE = re.compile(r"^[A-Za-z0-9_\-.~/]+$")
_USERNAME_RE = re.compile(r"^[A-Za-z0-9_.\-]{3,32}$")

Role = Literal["admin", "viewer"]


class StreamSummary(BaseModel):
    """Ringkasan satu stream untuk ditampilkan di tabel dashboard."""
    name: str
    label: Optional[str] = None
    location: Optional[str] = None
    online: bool
    source_type: Optional[str] = None
    tracks: list[str] = []
    readers: int = 0
    bytes_received: int = 0
    bytes_sent: int = 0
    online_since: Optional[str] = None
    urls: dict[str, str] = {}


# ---------------- kamera ----------------

class CameraCreate(BaseModel):
    name: str = Field(..., description="Nama path di MediaMTX (dipakai di URL)", examples=["kamera-1"])
    label: str = Field("", description="Nama tampilan di dashboard", examples=["Kamera Gerbang Depan"])
    location: str = Field("", examples=["Gedung AH lantai 1"])
    description: str = ""
    source: str = Field(
        "publisher",
        description="'publisher' jika stream dikirim ke MediaMTX (OBS/FFmpeg), "
                    "atau URL sumber seperti rtsp://user:pass@ip:554/stream",
        examples=["rtsp://admin:admin@192.168.1.20:554/stream1"],
    )
    source_on_demand: bool = Field(False, description="Tarik sumber hanya saat ada penonton")
    record: bool = False
    enabled: bool = Field(True, description="false = disimpan tapi tidak didaftarkan ke MediaMTX")

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str) -> str:
        v = v.strip().strip("/")
        if not v or not _NAME_RE.match(v):
            raise ValueError("Nama hanya boleh huruf, angka, dan - _ . ~ /")
        return v

    @field_validator("source")
    @classmethod
    def check_source(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Source tidak boleh kosong")
        return v


class CameraUpdate(BaseModel):
    """Isi field yang ingin diubah saja."""
    label: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    source: Optional[str] = None
    source_on_demand: Optional[bool] = None
    record: Optional[bool] = None
    enabled: Optional[bool] = None


# ---------------- login & user ----------------

class LoginRequest(BaseModel):
    username: str = Field(..., examples=["admin"])
    password: str = Field(..., examples=["admin123"])


class UserCreate(BaseModel):
    username: str = Field(..., examples=["operator1"])
    password: str = Field(..., min_length=6)
    role: Role = "viewer"

    @field_validator("username")
    @classmethod
    def check_username(cls, v: str) -> str:
        v = v.strip()
        if not _USERNAME_RE.match(v):
            raise ValueError("Username 3-32 karakter: huruf, angka, _ . -")
        return v


class UserUpdate(BaseModel):
    password: Optional[str] = Field(None, min_length=6)
    role: Optional[Role] = None


class PasswordChange(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=6)
