from functools import lru_cache
from config import settings
from mediamtx_client import MediaMTXClient, MockMediaMTXClient


@lru_cache
def get_mediamtx_client() -> MediaMTXClient:
    if settings.USE_MOCK:
        return MockMediaMTXClient()
    return MediaMTXClient()