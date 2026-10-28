"""The control-plane API. ``create_app`` takes its settings so tests and hosts build it the same way."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import auth
from .agents import load_agents
from .config import Settings
from .db import migrate, open_pool


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()  # pyright: ignore[reportCallIssue]

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        # Fail at start, not on the first request, when the agent list and its config disagree.
        app.state.agents = load_agents(settings.agents_file, settings.agents_config)
        pool = await open_pool(settings.database_url, settings.db_pool_max)
        async with pool.connection() as conn:
            await migrate(conn)
        app.state.pool = pool
        try:
            yield
        finally:
            await pool.close()

    app = FastAPI(title="Mergit control plane", version="0", lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Content-Type"],
    )
    app.include_router(auth.router)
    return app
