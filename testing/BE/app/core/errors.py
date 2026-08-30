from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError


class AppError(Exception):
    """Application error rendered as the standard error envelope."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: Any | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(message)


class NotFound(AppError):
    def __init__(self, message: str = "Resource not found", details: Any | None = None) -> None:
        super().__init__("not_found", message, status.HTTP_404_NOT_FOUND, details)


class Conflict(AppError):
    def __init__(self, code: str = "conflict", message: str = "Resource conflict", details: Any | None = None) -> None:
        super().__init__(code, message, status.HTTP_409_CONFLICT, details)


class Unauthorized(AppError):
    def __init__(self, message: str = "Not authenticated", details: Any | None = None) -> None:
        super().__init__("unauthorized", message, status.HTTP_401_UNAUTHORIZED, details)


class Unprocessable(AppError):
    def __init__(self, code: str = "unprocessable", message: str = "Request could not be processed", details: Any | None = None) -> None:
        super().__init__(code, message, status.HTTP_422_UNPROCESSABLE_ENTITY, details)


def error_payload(code: str, message: str, details: Any | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
        headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == status.HTTP_401_UNAUTHORIZED else None
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(exc.code, exc.message, exc.details),
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=error_payload("validation_error", "Request validation failed", jsonable_encoder(exc.errors())),
        )

    @app.exception_handler(IntegrityError)
    async def integrity_error_handler(_request: Request, _exc: IntegrityError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=error_payload("conflict", "Resource conflict"),
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(_request: Request, _exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=error_payload("internal_error", "Internal server error"),
        )
