"""Sesi & koneksi klien (publisher/penonton) dan memutusnya."""

import asyncio

from fastapi import APIRouter, Depends

from ..deps import get_client, get_current_user, require_admin
from ..mediamtx_client import SESSION_TYPES, MediaMTXError
from ..responses import fail, ok

router = APIRouter(prefix="/api/sessions", tags=["Sessions (klien)"])


@router.get("", summary="Semua sesi/koneksi aktif dari semua protokol")
async def list_sessions(client=Depends(get_client), _=Depends(get_current_user)):
    async def fetch(kind: str):
        try:
            return kind, await client.list_sessions(kind)
        except MediaMTXError as e:
            # Protokol yang dimatikan di mediamtx.yml mengembalikan error; anggap kosong
            if e.status_code in (404, 400, 500):
                return kind, []
            raise

    results = await asyncio.gather(*(fetch(k) for k in SESSION_TYPES))
    items = []
    for kind, sessions in results:
        for sess in sessions:
            items.append({"type": kind, **sess})
    return ok(items, f"{len(items)} sesi aktif")


@router.post("/{kind}/{session_id}/kick", summary="Putus koneksi satu klien (admin)")
async def kick(kind: str, session_id: str, client=Depends(get_client), _=Depends(require_admin)):
    if kind not in SESSION_TYPES:
        return fail(f"Jenis sesi tidak dikenal. Pilihan: {', '.join(SESSION_TYPES)}", 400)
    await client.kick_session(kind, session_id)
    return ok({"type": kind, "id": session_id}, "Koneksi diputus")
