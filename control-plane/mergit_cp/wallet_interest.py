"""``POST /v0/wallet-interest``: "Notify me" for wallets Mergit does not support yet.

Only MetaMask works today. Someone who wants another wallet says which, and the count tells us what to build
next. It is a demand signal, not a verified count: a signed-in person is counted once per wallet by account, a
signed-out visitor once per wallet per random token their browser keeps, and new rows are throttled so a
script cannot fill the table. The wallets on offer are fixed, so there is no free text to abuse.
"""

import re
from typing import Annotated, Literal, get_args

from fastapi import APIRouter, HTTPException
from psycopg import Connection
from psycopg.rows import TupleRow
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .auth import MaybePrincipalDep, PoolDep, SettingsDep

Wallet = Literal["coinbase", "coindcx", "trust", "phantom", "rabby", "other"]
WALLETS: tuple[str, ...] = get_args(Wallet)

router = APIRouter(prefix="/v0/wallet-interest", tags=["wallets"])

_TOKEN = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


class Interest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    wallets: Annotated[list[Wallet], Field(min_length=1, max_length=6)]
    token: str | None = None
    """A random id the browser keeps, for visitors who are not signed in."""

    @field_validator("token")
    @classmethod
    def _shape(cls, value: str | None) -> str | None:
        if value is not None and not _TOKEN.match(value):
            raise ValueError("token must be 16 to 64 letters, digits, - or _")
        return value


@router.post("", status_code=204)
async def record(body: Interest, settings: SettingsDep, pool: PoolDep, principal: MaybePrincipalDep) -> None:
    user_id = principal.user_id if principal else None
    if user_id is None and body.token is None:
        raise HTTPException(status_code=422, detail="a token is needed when not signed in")
    wallets = sorted(set(body.wallets))
    async with pool.connection() as conn, conn.transaction():
        cur = await conn.execute(
            "SELECT count(*) FROM wallet_interest WHERE created_at > now() - interval '1 minute'"
        )
        recent = await cur.fetchone()
        assert recent is not None
        if recent[0] + len(wallets) > settings.wallet_interest_per_minute:
            raise HTTPException(status_code=429, detail="too many requests; try again in a minute")
        for wallet in wallets:
            if user_id is not None:
                await conn.execute(
                    "INSERT INTO wallet_interest (wallet, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    (wallet, user_id),
                )
            else:
                await conn.execute(
                    "INSERT INTO wallet_interest (wallet, anon_token) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    (wallet, body.token),
                )


def interest_counts(conn: Connection[TupleRow]) -> dict[str, tuple[int, int]]:
    """Per wallet: (people, of them signed in). A person is an account or a token, never a click."""
    rows = conn.execute(
        "SELECT wallet, count(*), count(user_id) FROM wallet_interest GROUP BY wallet ORDER BY wallet"
    ).fetchall()
    return {str(w): (int(str(n)), int(str(signed))) for w, n, signed in rows}
