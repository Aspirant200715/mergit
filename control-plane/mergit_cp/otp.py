"""Sign-in with an emailed one-time code.

A code is six digits, lives ten minutes, allows five wrong guesses and works once. Only an HMAC of the
code (bound to the address it was sent to) is stored. Sending is rate-limited per address, and a new code
replaces the one before it. Neither route says whether an address already has an account.
"""

import asyncio
import hashlib
import hmac
import re
import secrets
import smtplib
import ssl
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from typing import Annotated, Protocol

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, field_validator

from . import accounts
from .auth import MaybePrincipalDep, PoolDep, SettingsDep
from .config import Settings

router = APIRouter(prefix="/v0/auth/email", tags=["auth"])

_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


class Mailer(Protocol):
    async def send(self, to: str, subject: str, body: str) -> None: ...


class SmtpMailer:
    """Plain SMTP with STARTTLS (port 587) or implicit TLS (port 465)."""

    def __init__(self, settings: Settings) -> None:
        assert settings.smtp_host and settings.smtp_from
        self._s = settings

    async def send(self, to: str, subject: str, body: str) -> None:
        await asyncio.to_thread(self._send, to, subject, body)

    def _send(self, to: str, subject: str, body: str) -> None:
        s = self._s
        assert s.smtp_host and s.smtp_from
        message = EmailMessage()
        message["From"], message["To"], message["Subject"] = s.smtp_from, to, subject
        message.set_content(body)
        context = ssl.create_default_context()
        if s.smtp_port == 465:
            server: smtplib.SMTP = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=15, context=context)
        else:
            server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15)
        with server:
            if s.smtp_port != 465:
                server.starttls(context=context)
            if s.smtp_user and s.smtp_password:
                server.login(s.smtp_user, s.smtp_password.get_secret_value())
            server.send_message(message)


def get_mailer(request: Request) -> Mailer:
    mailer: Mailer | None = request.app.state.mailer
    if mailer is None:
        raise HTTPException(status_code=404, detail="email sign-in is not set up")
    return mailer


MailerDep = Annotated[Mailer, Depends(get_mailer)]


def _clean(value: str) -> str:
    value = value.strip().lower()
    if len(value) > 254 or not _EMAIL.match(value):
        raise ValueError("not an email address")
    return value


class StartBody(BaseModel):
    email: str

    _clean = field_validator("email")(_clean)


class VerifyBody(StartBody):
    code: str
    intent: accounts.Intent = "register"

    @field_validator("code")
    @classmethod
    def _six_digits(cls, value: str) -> str:
        if not re.fullmatch(r"[0-9]{6}", value):
            raise ValueError("the code is six digits")
        return value


def _code_hash(settings: Settings, email: str, code: str) -> bytes:
    key = settings.session_secret.get_secret_value().encode()
    return hmac.new(key, f"otp:{email}:{code}".encode(), hashlib.sha256).digest()


@router.post("/start", status_code=204)
async def start(body: StartBody, settings: SettingsDep, pool: PoolDep, mailer: MailerDep) -> None:
    code = f"{secrets.randbelow(10**6):06d}"
    expires = datetime.now(UTC) + timedelta(seconds=settings.otp_ttl_s)
    async with pool.connection() as conn, conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"otp:{body.email}",))
        cur = await conn.execute(
            "SELECT count(*) FROM email_otps WHERE email = %s AND created_at > now() - interval '1 hour'",
            (body.email,),
        )
        row = await cur.fetchone()
        assert row is not None
        if row[0] >= settings.otp_sends_per_hour:
            raise HTTPException(status_code=429, detail="too many codes sent to that address; try later")
        await conn.execute(
            "UPDATE email_otps SET used_at = now() WHERE email = %s AND used_at IS NULL", (body.email,)
        )
        await conn.execute(
            "INSERT INTO email_otps (email, code_hash, expires_at) VALUES (%s, %s, %s)",
            (body.email, _code_hash(settings, body.email, code), expires),
        )
    minutes = settings.otp_ttl_s // 60
    try:
        await mailer.send(
            body.email,
            "Your Mergit sign-in code",
            f"Your Mergit sign-in code is {code}.\n\nIt works once and expires in {minutes} minutes."
            "\nIf you did not ask for it, ignore this email.\n",
        )
    except Exception as exc:  # smtplib raises OSError and its own hierarchy; none of it is for the browser
        raise HTTPException(status_code=502, detail="could not send the code") from exc


@router.post("/verify")
async def verify(
    body: VerifyBody, response: Response, settings: SettingsDep, pool: PoolDep, principal: MaybePrincipalDep
) -> dict[str, str]:
    async with pool.connection() as conn, conn.transaction():
        cur = await conn.execute(
            "SELECT otp_id, code_hash, attempts FROM email_otps"
            " WHERE email = %s AND used_at IS NULL AND expires_at > now()"
            " ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
            (body.email,),
        )
        row = await cur.fetchone()
        accepted = False
        if row is not None and row[2] < settings.otp_max_attempts:
            right = hmac.compare_digest(bytes(row[1]), _code_hash(settings, body.email, body.code))
            unregistered = (
                body.intent == "login"
                and principal is None
                and not await accounts.identity_exists(conn, "email", body.email)
            )
            if right and unregistered:
                # Said only after the code proves the address is theirs, so a stranger cannot learn who has an
                # account. The code is not spent: the same one still creates the account.
                raise HTTPException(status_code=404, detail="no_account")
            accepted = right
            # A wrong guess is counted and a right one is spent, in the same transaction as the check.
            if accepted:
                await conn.execute("UPDATE email_otps SET used_at = now() WHERE otp_id = %s", (row[0],))
            else:
                await conn.execute(
                    "UPDATE email_otps SET attempts = attempts + 1 WHERE otp_id = %s", (row[0],)
                )
        if not accepted:
            user_id = None
        else:
            try:
                user_id = await accounts.sign_in_identity(
                    conn,
                    "email",
                    body.email,
                    label=body.email,
                    email=body.email,
                    link_to=principal.user_id if principal else None,
                )
            except accounts.IdentityTaken:
                user_id = None
        if user_id is None:
            address = ""
            token = None
        elif principal is not None and principal.user_id == user_id:
            address, token = principal.address, None
        else:
            address = await accounts.default_address(conn, user_id)
            token = await accounts.create_session(conn, settings, user_id, address)
    if user_id is None:
        raise HTTPException(status_code=401, detail="that code is not valid")
    if token is not None:
        accounts.set_session_cookie(response, settings, token)
    return {"address": address}
