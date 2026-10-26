"""Database SQLite (satu file, tanpa server database).

File database dibuat otomatis di lokasi DATABASE_PATH (default: data.db).
"""

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

_db_path = "data.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS cameras (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL UNIQUE,       -- nama path di MediaMTX
    label            TEXT NOT NULL DEFAULT '',   -- nama tampilan di dashboard
    location         TEXT NOT NULL DEFAULT '',
    description      TEXT NOT NULL DEFAULT '',
    source           TEXT NOT NULL DEFAULT 'publisher',
    source_on_demand INTEGER NOT NULL DEFAULT 0,
    record           INTEGER NOT NULL DEFAULT 0,
    enabled          INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'viewer',  -- 'admin' atau 'viewer'
    created_at    TEXT NOT NULL
);
"""


def init_db(path: str) -> None:
    global _db_path
    _db_path = path
    with connect() as conn:
        conn.executescript(SCHEMA)


@contextmanager
def connect():
    conn = sqlite3.connect(_db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
