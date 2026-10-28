"""Request-scoped access to the process-wide settings and database pool."""

from typing import cast

from fastapi import Request

from .config import Settings
from .db import Pool


def get_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def get_pool(request: Request) -> Pool:
    return cast(Pool, request.app.state.pool)
