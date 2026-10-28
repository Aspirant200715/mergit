"""Sign-In with Ethereum (EIP-4361) and server-side sessions.

The wallet that signs in is the wallet that approves and funds a plan, so every plan route depends on
``current_address``. Nonces are single use and short lived; sessions live in Postgres so logout revokes
them everywhere, not just in the browser that logged out.
"""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel
from siwe import SiweMessage, VerificationError, generate_nonce

from .config import Settings
from .db import Pool
from .deps import get_pool, get_settings

COOKIE = "mergit_session"

router = APIRouter(prefix="/v0/auth", tags=["auth"])

SettingsDep = Annotated[Settings, Depends(get_settings)]
PoolDep = Annotated[Pool, Depends(get_pool)]


class VerifyBody(BaseModel):
    message: str
    signature: str


def _token_hash(settings: Settings, token: str) -> bytes:
    return hmac.new(
        settings.session_secret.get_secret_value().encode(), token.encode(), hashlib.sha256
    ).digest()


def _unauthorized(reason: str) -> HTTPException:
    return HTTPException(status_code=401, detail=reason)


@router.get("/nonce")
async def nonce(settings: SettingsDep, pool: PoolDep) -> dict[str, str]:
    value = generate_nonce()
    expires = datetime.now(UTC) + timedelta(seconds=settings.nonce_ttl_s)
    async with pool.connection() as conn:
        await conn.execute("INSERT INTO auth_nonces (nonce, expires_at) VALUES (%s, %s)", (value, expires))
    return {"nonce": value}


@router.post("/verify")
async def verify(
    body: VerifyBody, response: Response, settings: SettingsDep, pool: PoolDep
) -> dict[str, str]:
    try:
        message = SiweMessage.from_message(body.message)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="malformed SIWE message") from exc

    if message.chain_id != settings.chain_id:
        raise _unauthorized("wrong chain")
    try:
        # Checks the domain, the expiry and not-before fields, and that the signature recovers to the address.
        message.verify(body.signature, domain=settings.app_domain)
    except VerificationError as exc:
        raise _unauthorized(type(exc).__name__) from exc

    address = message.address.lower()
    token = secrets.token_urlsafe(32)
    expires = datetime.now(UTC) + timedelta(seconds=settings.session_ttl_s)
    async with pool.connection() as conn, conn.transaction():
        # Consuming the nonce is the last check and is atomic, so two requests racing on one nonce cannot
        # both get a session.
        cur = await conn.execute(
            "UPDATE auth_nonces SET used_at = now()"
            " WHERE nonce = %s AND used_at IS NULL AND expires_at > now() RETURNING nonce",
            (message.nonce,),
        )
        if await cur.fetchone() is None:
            raise _unauthorized("nonce unknown, used or expired")
        await conn.execute(
            "INSERT INTO sessions (token_hash, address, expires_at) VALUES (%s, %s, %s)",
            (_token_hash(settings, token), address, expires),
        )

    response.set_cookie(
        COOKIE,
        token,
        max_age=settings.session_ttl_s,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )
    return {"address": address}


async def current_address(
    settings: SettingsDep, pool: PoolDep, mergit_session: Annotated[str | None, Cookie()] = None
) -> str:
    """The signed-in wallet address, lowercase. 401 when there is no live session."""
    if not mergit_session:
        raise _unauthorized("not signed in")
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT address FROM sessions"
            " WHERE token_hash = %s AND revoked_at IS NULL AND expires_at > now()",
            (_token_hash(settings, mergit_session),),
        )
        row = await cur.fetchone()
    if row is None:
        raise _unauthorized("session expired or revoked")
    return str(row[0])


AddressDep = Annotated[str, Depends(current_address)]


@router.get("/me")
async def me(address: AddressDep) -> dict[str, str]:
    return {"address": address}


@router.post("/logout", status_code=204)
async def logout(
    response: Response,
    settings: SettingsDep,
    pool: PoolDep,
    mergit_session: Annotated[str | None, Cookie()] = None,
) -> None:
    if mergit_session:
        async with pool.connection() as conn:
            await conn.execute(
                "UPDATE sessions SET revoked_at = now() WHERE token_hash = %s AND revoked_at IS NULL",
                (_token_hash(settings, mergit_session),),
            )
    response.delete_cookie(COOKIE, path="/", secure=True, httponly=True, samesite="lax")
