"""Postgres access: one async pool per process, numbered plain-SQL migrations."""

import asyncio
from pathlib import Path
from typing import LiteralString, cast

from psycopg import AsyncConnection
from psycopg.rows import TupleRow
from psycopg_pool import AsyncConnectionPool

Pool = AsyncConnectionPool[AsyncConnection[TupleRow]]

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"

# Any constant works; it only has to be the same in every process that migrates this database.
_MIGRATION_LOCK = 0x6D65726769


async def open_pool(database_url: str, max_size: int) -> Pool:
    pool = Pool(database_url, min_size=1, max_size=max_size, open=False)
    await pool.open(wait=True)
    return pool


def _read_migrations(directory: Path) -> list[tuple[str, str]]:
    return [(path.stem, path.read_text()) for path in sorted(directory.glob("*.sql"))]


async def migrate(conn: AsyncConnection, directory: Path = MIGRATIONS_DIR) -> list[str]:
    """Apply every migration not yet applied, in file-name order. Returns the versions applied.

    An advisory lock serialises concurrent API instances starting at once.
    """
    migrations = await asyncio.to_thread(_read_migrations, directory)
    applied: list[str] = []
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock(%s)", (_MIGRATION_LOCK,))
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations"
            " (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        cur = await conn.execute("SELECT version FROM schema_migrations")
        done = {row[0] for row in await cur.fetchall()}
        for version, text in migrations:
            if version in done:
                continue
            # Migration files are part of this repository, never user input.
            await conn.execute(cast(LiteralString, text))
            await conn.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (version,))
            applied.append(version)
    return applied
