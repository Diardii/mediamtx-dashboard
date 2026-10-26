"""Operasi database untuk tabel cameras dan users."""

import sqlite3
from typing import Any, Optional

from .database import connect, now_iso
from .errors import AppError

_CAMERA_FIELDS = ("label", "location", "description", "source", "source_on_demand", "record", "enabled")
_BOOL_FIELDS = ("source_on_demand", "record", "enabled")


def _camera(row: sqlite3.Row) -> dict:
    d = dict(row)
    for f in _BOOL_FIELDS:
        d[f] = bool(d[f])
    return d


# ---------------- cameras ----------------

def list_cameras() -> list[dict]:
    with connect() as c:
        return [_camera(r) for r in c.execute("SELECT * FROM cameras ORDER BY name")]


def get_camera(name: str) -> Optional[dict]:
    with connect() as c:
        r = c.execute("SELECT * FROM cameras WHERE name = ?", (name,)).fetchone()
        return _camera(r) if r else None


def create_camera(name: str, data: dict[str, Any]) -> dict:
    now = now_iso()
    values = {f: data.get(f) for f in _CAMERA_FIELDS if data.get(f) is not None}
    cols = ["name", *values, "created_at", "updated_at"]
    params = [name, *values.values(), now, now]
    try:
        with connect() as c:
            c.execute(
                f"INSERT INTO cameras ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                params,
            )
    except sqlite3.IntegrityError:
        raise AppError(f"Kamera '{name}' sudah ada", 409)
    return get_camera(name)


def update_camera(name: str, data: dict[str, Any]) -> dict:
    values = {f: data[f] for f in _CAMERA_FIELDS if data.get(f) is not None}
    if values:
        sets = ", ".join(f"{k} = ?" for k in values)
        with connect() as c:
            c.execute(
                f"UPDATE cameras SET {sets}, updated_at = ? WHERE name = ?",
                [*values.values(), now_iso(), name],
            )
    return get_camera(name)


def delete_camera(name: str) -> None:
    with connect() as c:
        c.execute("DELETE FROM cameras WHERE name = ?", (name,))


# ---------------- users ----------------

def _user(row: sqlite3.Row, with_hash: bool = False) -> dict:
    d = dict(row)
    if not with_hash:
        d.pop("password_hash", None)
    return d


def count_users() -> int:
    with connect() as c:
        return c.execute("SELECT COUNT(*) FROM users").fetchone()[0]


def list_users() -> list[dict]:
    with connect() as c:
        return [_user(r) for r in c.execute("SELECT * FROM users ORDER BY username")]


def get_user(username: str, with_hash: bool = False) -> Optional[dict]:
    with connect() as c:
        r = c.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        return _user(r, with_hash) if r else None


def create_user(username: str, password_hash: str, role: str) -> dict:
    try:
        with connect() as c:
            c.execute(
                "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
                (username, password_hash, role, now_iso()),
            )
    except sqlite3.IntegrityError:
        raise AppError(f"Username '{username}' sudah dipakai", 409)
    return get_user(username)


def update_user(username: str, password_hash: Optional[str] = None, role: Optional[str] = None) -> dict:
    with connect() as c:
        if password_hash is not None:
            c.execute("UPDATE users SET password_hash = ? WHERE username = ?", (password_hash, username))
        if role is not None:
            c.execute("UPDATE users SET role = ? WHERE username = ?", (role, username))
    return get_user(username)


def delete_user(username: str) -> None:
    with connect() as c:
        c.execute("DELETE FROM users WHERE username = ?", (username,))


def count_admins() -> int:
    with connect() as c:
        return c.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'").fetchone()[0]
