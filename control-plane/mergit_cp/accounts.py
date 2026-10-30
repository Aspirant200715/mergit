"""Users, the ways they sign in, their wallets, and server-side sessions.

A user is created by the first sign-in with a method nobody has used before and is only ever joined to
another method by that same user, signed in, asking for it. Nothing merges accounts by email: a GitHub
address can be unverified, and a merge is an account takeover when it is wrong.

A user with no wallet still has a requester address on chain: ``trial_address``, a hash nobody holds a key
for. Onboarding plans refund to the treasury, not to the requester (Escrow ``_refundAddress``), so nothing
sent to it is stranded, and the gateway's per-address credit grant and daily limit become per user.
"""

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

from fastapi import Response
from psycopg import AsyncConnection
from psycopg.rows import TupleRow

from .config import Settings

COOKIE = "mergit_session"

Conn = AsyncConnection[TupleRow]
Provider = Literal["github", "google", "email"]
Intent = Literal["login", "register"]


class NoAccount(Exception):
    """Signing in (not registering) with an identity or wallet nobody has registered."""


class IdentityTaken(Exception):
    """The identity already signs in to a different user."""


class WalletTaken(Exception):
    """The wallet already belongs to a different user."""


def trial_address(user_id: UUID) -> str:
    """The on-chain requester of a user's free-credit plans while they have no wallet: lowercase 0x + 40 hex.

    Not derived from any private key, so no one can spend from it or sign as it.
    """
    digest = hashlib.sha256(b"mergit.trial.v0:" + user_id.bytes).digest()
    return "0x" + digest[-20:].hex()


def token_hash(settings: Settings, token: str) -> bytes:
    return hmac.new(
        settings.session_secret.get_secret_value().encode(), token.encode(), hashlib.sha256
    ).digest()


async def create_session(conn: Conn, settings: Settings, user_id: UUID, address: str) -> str:
    """Stores a session and returns the cookie token. Only an HMAC of the token is stored."""
    token = secrets.token_urlsafe(32)
    expires = datetime.now(UTC) + timedelta(seconds=settings.session_ttl_s)
    await conn.execute(
        "INSERT INTO sessions (token_hash, address, user_id, expires_at) VALUES (%s, %s, %s, %s)",
        (token_hash(settings, token), address, user_id, expires),
    )
    return token


def set_session_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        COOKIE,
        token,
        max_age=settings.session_ttl_s,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )


async def create_user(
    conn: Conn, *, name: str | None = None, email: str | None = None, avatar: str | None = None
) -> UUID:
    cur = await conn.execute(
        "INSERT INTO users (display_name, email, avatar_url) VALUES (%s, %s, %s) RETURNING user_id",
        (name, email, avatar),
    )
    row = await cur.fetchone()
    assert row is not None
    return row[0]


async def fill_profile(
    conn: Conn, user_id: UUID, *, name: str | None, email: str | None, avatar: str | None
) -> None:
    """Fills what is still empty; never overwrites what the user already has."""
    await conn.execute(
        "UPDATE users SET display_name = COALESCE(display_name, %s), email = COALESCE(email, %s),"
        " avatar_url = COALESCE(avatar_url, %s) WHERE user_id = %s",
        (name, email, avatar, user_id),
    )


async def sign_in_identity(
    conn: Conn,
    provider: Provider,
    subject: str,
    *,
    label: str,
    name: str | None = None,
    email: str | None = None,
    avatar: str | None = None,
    link_to: UUID | None = None,
) -> UUID:
    """The user this identity signs in to. Creates the user on first use, or, with ``link_to``, attaches
    the identity to that user. Raises ``IdentityTaken`` rather than moving it from another user."""
    owner = await _identity_owner(conn, provider, subject)
    if owner is None:
        user_id = link_to or await create_user(conn, name=name, email=email, avatar=avatar)
        cur = await conn.execute(
            "INSERT INTO identities (provider, subject, user_id, label) VALUES (%s, %s, %s, %s)"
            " ON CONFLICT DO NOTHING RETURNING user_id",
            (provider, subject, user_id, label),
        )
        if await cur.fetchone() is not None:
            if link_to is not None:
                await fill_profile(conn, user_id, name=name, email=email, avatar=avatar)
            return user_id
        # Two requests raced on a new identity: the other one won; fall through to its owner.
        owner = await _identity_owner(conn, provider, subject)
        assert owner is not None
    if link_to is not None and owner != link_to:
        raise IdentityTaken
    return owner


async def _identity_owner(conn: Conn, provider: str, subject: str) -> UUID | None:
    cur = await conn.execute(
        "SELECT user_id FROM identities WHERE provider = %s AND subject = %s", (provider, subject)
    )
    row = await cur.fetchone()
    return row[0] if row else None


async def identity_exists(conn: Conn, provider: str, subject: str) -> bool:
    return await _identity_owner(conn, provider, subject) is not None


async def wallet_exists(conn: Conn, address: str) -> bool:
    cur = await conn.execute("SELECT 1 FROM wallets WHERE address = %s", (address,))
    return await cur.fetchone() is not None


async def user_for_wallet(conn: Conn, address: str) -> UUID:
    """The user that owns this wallet, created on its first sign-in."""
    cur = await conn.execute("SELECT user_id FROM wallets WHERE address = %s", (address,))
    row = await cur.fetchone()
    if row is not None:
        return row[0]
    user_id = await create_user(conn)
    cur = await conn.execute(
        "INSERT INTO wallets (address, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING RETURNING address",
        (address, user_id),
    )
    if await cur.fetchone() is not None:
        return user_id
    await conn.execute("DELETE FROM users WHERE user_id = %s", (user_id,))
    cur = await conn.execute("SELECT user_id FROM wallets WHERE address = %s", (address,))
    row = await cur.fetchone()
    assert row is not None
    return row[0]


async def link_wallet(conn: Conn, user_id: UUID, address: str) -> None:
    """Attaches a wallet the caller has just proved they hold. Idempotent for the same user."""
    cur = await conn.execute(
        "INSERT INTO wallets (address, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING RETURNING address",
        (address, user_id),
    )
    if await cur.fetchone() is not None:
        return
    cur = await conn.execute("SELECT user_id FROM wallets WHERE address = %s", (address,))
    row = await cur.fetchone()
    if row is None or row[0] != user_id:
        raise WalletTaken


async def owned_addresses(conn: Conn, user_id: UUID | None, session_address: str) -> list[str]:
    """Every requester address whose plans this user may see and change."""
    if user_id is None:
        return [session_address]
    cur = await conn.execute("SELECT address FROM wallets WHERE user_id = %s ORDER BY created_at", (user_id,))
    return [*(r[0] for r in await cur.fetchall()), trial_address(user_id)]


async def default_address(conn: Conn, user_id: UUID) -> str:
    """The address a fresh session acts as: the user's first wallet, else their trial address."""
    cur = await conn.execute(
        "SELECT address FROM wallets WHERE user_id = %s ORDER BY created_at LIMIT 1", (user_id,)
    )
    row = await cur.fetchone()
    return row[0] if row else trial_address(user_id)


@dataclass(frozen=True, slots=True)
class Profile:
    user_id: UUID
    name: str | None
    email: str | None
    avatar_url: str | None
    trial_started_at: datetime | None
    identities: list[tuple[str, str]]
    wallets: list[str]


async def load_profile(conn: Conn, user_id: UUID) -> Profile:
    cur = await conn.execute(
        "SELECT display_name, email, avatar_url, trial_started_at FROM users WHERE user_id = %s", (user_id,)
    )
    row = await cur.fetchone()
    assert row is not None
    cur = await conn.execute(
        "SELECT provider, label FROM identities WHERE user_id = %s ORDER BY created_at", (user_id,)
    )
    identities = [(r[0], r[1]) for r in await cur.fetchall()]
    cur = await conn.execute("SELECT address FROM wallets WHERE user_id = %s ORDER BY created_at", (user_id,))
    wallets = [r[0] for r in await cur.fetchall()]
    return Profile(user_id, row[0], row[1], row[2], row[3], identities, wallets)


async def start_trial(conn: Conn, user_id: UUID) -> datetime:
    cur = await conn.execute(
        "UPDATE users SET trial_started_at = COALESCE(trial_started_at, now()) WHERE user_id = %s"
        " RETURNING trial_started_at",
        (user_id,),
    )
    row = await cur.fetchone()
    assert row is not None
    return row[0]
