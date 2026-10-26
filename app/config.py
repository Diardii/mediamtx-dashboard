"""Pengaturan aplikasi, dibaca dari file .env."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- MediaMTX ---
    mediamtx_api_url: str = "http://localhost:9997"
    mediamtx_api_user: str = ""
    mediamtx_api_pass: str = ""

    mediamtx_webrtc_url: str = "http://localhost:8889"
    mediamtx_hls_url: str = "http://localhost:8888"
    mediamtx_rtsp_url: str = "rtsp://localhost:8554"

    use_mock: bool = False

    # --- Database ---
    database_path: str = "data.db"
    # Cek & daftarkan ulang kamera ke MediaMTX tiap N detik (0 = mati)
    sync_interval_seconds: int = 30

    # --- Login ---
    secret_key: str = ""
    token_expire_minutes: int = 480
    admin_username: str = "admin"
    admin_password: str = "admin123"

    # --- Frontend ---
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
