"""Format respons standar: { success, data, message }."""

from typing import Any

from fastapi.responses import JSONResponse


def ok(data: Any = None, message: str = "OK") -> dict:
    return {"success": True, "data": data, "message": message}


def fail(message: str, status_code: int = 400, data: Any = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"success": False, "data": data, "message": message},
    )
