"""Backend dashboard pengelolaan MediaMTX.

Jalankan:  uvicorn app.main:app --reload
Dashboard:                  http://localhost:8000
Dokumentasi & uji coba API:  http://localhost:8000/docs
"""

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import camera_service, repos, security
from .config import get_settings
from .database import init_db
from .errors import AppError
from .mediamtx_client import MediaMTXError, build_client
from .responses import fail, ok
from .routers import auth, cameras, protocols, server, sessions, streams, users

logging.basicConfig(level=logging.INFO, format="%(levelname)s:     [%(name)s] %(message)s")
log = logging.getLogger("app")


def _seed_admin(settings) -> None:
    """Buat akun admin pertama jika tabel users masih kosong."""
    if repos.count_users() == 0:
        repos.create_user(settings.admin_username, security.hash_password(settings.admin_password), "admin")
        log.warning("Akun admin dibuat: '%s'. Segera ganti password lewat /api/auth/change-password.",
                    settings.admin_username)


async def _sync_once(client, full: bool) -> None:
    try:
        report = await camera_service.sync(client, full=full)
        if report["added"] or report["updated"] or report["failed"]:
            log.info("Sinkron kamera: %s", report)
    except MediaMTXError as e:
        log.warning("Sinkron kamera dilewati: %s", e.message)


async def _sync_loop(client, interval: int) -> None:
    """Daftarkan ulang kamera yang hilang (misal MediaMTX baru di-restart)."""
    while True:
        await asyncio.sleep(interval)
        await _sync_once(client, full=False)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_db(settings.database_path)
    security.configure(settings.secret_key, settings.token_expire_minutes)
    _seed_admin(settings)

    client = build_client(settings)
    app.state.mediamtx = client
    await _sync_once(client, full=True)

    task = None
    if settings.sync_interval_seconds > 0:
        task = asyncio.create_task(_sync_loop(client, settings.sync_interval_seconds))

    yield

    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    await client.close()


app = FastAPI(
    title="MediaMTX Dashboard API",
    description=(
        "Backend untuk memantau dan mengelola server MediaMTX.\n\n"
        "**Cara login di halaman ini:** jalankan `POST /api/auth/login`, salin nilai "
        "`access_token`, klik tombol **Authorize** di kanan atas, tempel, lalu klik Authorize."
    ),
    version="0.5.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return fail(exc.message, exc.status_code)


@app.exception_handler(MediaMTXError)
async def mediamtx_error_handler(request: Request, exc: MediaMTXError):
    return fail(exc.message, exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    errors = [
        {"field": ".".join(str(x) for x in e["loc"][1:]), "message": e["msg"]}
        for e in exc.errors()
    ]
    return fail("Data yang dikirim tidak valid", 422, errors)


@app.get("/api/info", tags=["Server"], summary="Info aplikasi & alamat tonton stream (tanpa login)")
async def info():
    s = get_settings()
    return ok({
        "service": "mediamtx-dashboard",
        "version": app.version,
        "mock": s.use_mock,
        "webrtc_url": s.mediamtx_webrtc_url,
        "hls_url": s.mediamtx_hls_url,
        "rtsp_url": s.mediamtx_rtsp_url,
    })


app.include_router(auth.router)
app.include_router(server.router)
app.include_router(streams.router)
app.include_router(cameras.router)
app.include_router(sessions.router)
app.include_router(users.router)
app.include_router(protocols.router)

# Halaman dashboard (HTML/CSS/JS) disajikan dari folder app/static di alamat "/".
# Dipasang paling akhir supaya tidak menutupi /api dan /docs.
app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="dashboard")
