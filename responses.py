from typing import Generic, TypeVar
from pydantic import BaseModel

T = TypeVar("T")


class StandardResponse(BaseModel, Generic[T]):
    success: bool
    data: T | None
    message: str

    @classmethod
    def success(cls, data: T, message: str = "") -> "StandardResponse[T]":
        return cls(success=True, data=data, message=message)

    @classmethod
    def error(cls, message: str, data: T | None = None) -> "StandardResponse[T]":
        return cls(success=False, data=data, message=message)