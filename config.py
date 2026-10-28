from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    MEDIAMTX_API_URL: str = "http://mediamtx:9997"
    USE_MOCK: bool = False
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    LOG_FILE_PATH: str = "/var/log/mediamtx/mediamtx.log"


settings = Settings()
