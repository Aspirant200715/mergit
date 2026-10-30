"""Accounts: GitHub, Google and email sign-in create a user; a wallet is something the user connects.

The wallet sign-in in test_auth.py still has to work unchanged. Most tests here are guards that must fire:
a forged `state`, a reused or wrong one-time code, an unverified Google email, a wallet that already belongs
to someone else. Run with `pytest -m postgres`.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import psycopg
import pytest
import respx
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient
from pydantic import SecretStr
from siwe import SiweMessage

from mergit_cp.accounts import trial_address
from mergit_cp.app import create_app
from mergit_cp.config import Settings
from tests.conftest import APP_DOMAIN
from tests.cp_fakes import FakeLLM, result
from tests.test_auth import _nonce, _now, _signed
from tests.test_plans import BODY, planned

pytestmark = pytest.mark.postgres

GITHUB_TOKEN = "https://github.com/login/oauth/access_token"
GITHUB_USER = "https://api.github.com/user"
GITHUB_EMAILS = "https://api.github.com/user/emails"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"


class Outbox:
    """Stands in for the SMTP server: remembers what would have been sent."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, str, str]] = []

    async def send(self, to: str, subject: str, body: str) -> None:
        self.sent.append((to, subject, body))

    def last_code(self) -> str:
        match = re.search(r"\b(\d{6})\b", self.sent[-1][2])
        assert match
        return match.group(1)


@pytest.fixture
def outbox() -> Outbox:
    return Outbox()


@pytest.fixture
def configured(settings: Settings) -> Settings:
    return settings.model_copy(
        update={
            "github_client_id": "gh-id",
            "github_client_secret": SecretStr("gh-secret"),
            "google_client_id": "g-id",
            "google_client_secret": SecretStr("g-secret"),
            "smtp_host": "smtp.invalid",
            "smtp_from": "noreply@mergit.test",
        }
    )


@pytest.fixture
def client(configured: Settings, outbox: Outbox) -> Iterator[TestClient]:
    llm = FakeLLM([result(planned()) for _ in range(5)])
    app = create_app(configured, llm=llm, deliver_events=False, mailer=outbox)
    with TestClient(app, base_url="https://testserver", follow_redirects=False) as c:
        yield c
    with psycopg.connect(configured.database_url) as conn:
        tables = conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'"
        ).fetchall()
        conn.execute("TRUNCATE " + ", ".join(t[0] for t in tables) + " CASCADE")


def github_login(
    client: TestClient, *, subject: int = 4242, login: str = "octo", state: str | None = None
) -> httpx.Response:
    """Runs /start, then /callback with the provider mocked; returns the callback response."""
    start = client.get("/v0/auth/github/start")
    assert start.status_code == 302
    sent = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    with respx.mock(assert_all_called=False) as mock:
        mock.post(GITHUB_TOKEN).respond(json={"access_token": "gho_test", "token_type": "bearer"})
        mock.get(GITHUB_USER).respond(
            json={"id": subject, "login": login, "name": "Octo Cat", "avatar_url": "https://a/b.png"}
        )
        mock.get(GITHUB_EMAILS).respond(
            json=[{"email": "octo@example.com", "primary": True, "verified": True}]
        )
        return client.get("/v0/auth/github/callback", params={"code": "c0de", "state": state or sent})


def google_login(client: TestClient, *, sub: str = "g-1", verified: bool = True) -> httpx.Response:
    start = client.get("/v0/auth/google/start")
    sent = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    with respx.mock(assert_all_called=False) as mock:
        mock.post(GOOGLE_TOKEN).respond(json={"access_token": "ya29.test", "id_token": "unused"})
        mock.get(GOOGLE_USERINFO).respond(
            json={
                "sub": sub,
                "name": "Gee Oogle",
                "email": "gee@example.com",
                "email_verified": verified,
                "picture": "https://a/g.png",
            }
        )
        return client.get("/v0/auth/google/callback", params={"code": "c0de", "state": sent})


def sign_in_with_wallet(client: TestClient) -> str:
    address, body = _signed(_nonce(client))
    assert client.post("/v0/auth/verify", json=body).status_code == 200
    return address.lower()


def me(client: TestClient) -> dict[str, Any]:
    response = client.get("/v0/auth/me")
    assert response.status_code == 200, response.text
    return response.json()


# --- which methods are offered ------------------------------------------------------------------------


def test_providers_lists_only_what_is_configured(client: TestClient) -> None:
    assert client.get("/v0/auth/providers").json() == {
        "wallet": True,
        "github": True,
        "google": True,
        "email": True,
    }


def test_providers_hides_methods_without_credentials(settings: Settings) -> None:
    with TestClient(create_app(settings, deliver_events=False), base_url="https://testserver") as c:
        assert c.get("/v0/auth/providers").json() == {
            "wallet": True,
            "github": False,
            "google": False,
            "email": False,
        }
        assert c.get("/v0/auth/github/start").status_code == 404
        assert c.post("/v0/auth/email/start", json={"email": "a@b.co"}).status_code == 404


# --- GitHub and Google --------------------------------------------------------------------------------


def test_github_start_sends_state_and_pkce_and_binds_the_browser(client: TestClient) -> None:
    response = client.get("/v0/auth/github/start")
    assert response.status_code == 302
    url = urlsplit(response.headers["location"])
    assert f"{url.scheme}://{url.netloc}{url.path}" == "https://github.com/login/oauth/authorize"
    query = parse_qs(url.query)
    assert query["client_id"] == ["gh-id"]
    assert query["redirect_uri"] == ["https://app.mergit.test/v0/auth/github/callback"]
    assert query["code_challenge_method"] == ["S256"]
    assert len(query["state"][0]) >= 32
    assert query["code_challenge"][0]
    cookie = response.headers["set-cookie"]
    assert "mergit_oauth=" in cookie
    assert "HttpOnly" in cookie
    assert "Secure" in cookie


def test_github_login_creates_an_account_with_a_trial_address(client: TestClient) -> None:
    response = github_login(client)
    assert response.status_code == 302
    assert response.headers["location"] == "https://app.mergit.test/app"
    assert "mergit_session=" in "".join(response.headers.get_list("set-cookie"))
    profile = me(client)
    assert profile["name"] == "Octo Cat"
    assert profile["email"] == "octo@example.com"
    assert profile["identities"] == [{"provider": "github", "label": "octo"}]
    assert profile["wallets"] == []
    assert profile["address"] == profile["trial_address"]
    assert re.fullmatch(r"0x[0-9a-f]{40}", profile["address"])
    assert profile["trial"] is None


def test_the_same_github_account_signs_back_in_to_the_same_user(client: TestClient) -> None:
    github_login(client)
    first = me(client)
    client.post("/v0/auth/logout")
    client.cookies.clear()
    github_login(client)
    assert me(client)["user_id"] == first["user_id"]


def test_github_callback_rejects_a_state_we_did_not_issue(client: TestClient) -> None:
    response = github_login(client, state="x" * 43)
    assert response.status_code == 302
    assert response.headers["location"] == "https://app.mergit.test/signin?error=oauth_state"
    assert client.get("/v0/auth/me").status_code == 401


def test_github_callback_without_the_browser_cookie_is_rejected(client: TestClient) -> None:
    start = client.get("/v0/auth/github/start")
    sent = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    client.cookies.clear()  # an attacker's state delivered to a victim's browser
    response = client.get("/v0/auth/github/callback", params={"code": "c", "state": sent})
    assert response.headers["location"].endswith("/signin?error=oauth_state")
    assert client.get("/v0/auth/me").status_code == 401


def test_a_state_that_is_not_the_one_in_this_browsers_cookie_is_rejected(client: TestClient) -> None:
    """Login CSRF: an attacker starts a flow and sends its link to a victim, whose browser holds its own."""
    attacker = client.get("/v0/auth/github/start")
    attackers_state = parse_qs(urlsplit(attacker.headers["location"]).query)["state"][0]
    client.cookies.clear()
    client.get("/v0/auth/github/start")  # the victim's own flow, with its own cookie
    response = client.get("/v0/auth/github/callback", params={"code": "c", "state": attackers_state})
    assert response.headers["location"].endswith("/signin?error=oauth_state")
    assert client.get("/v0/auth/me").status_code == 401


def test_a_state_is_single_use(client: TestClient) -> None:
    start = client.get("/v0/auth/github/start")
    sent = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    with respx.mock(assert_all_called=False) as mock:
        mock.post(GITHUB_TOKEN).respond(json={"access_token": "t"})
        mock.get(GITHUB_USER).respond(json={"id": 1, "login": "a"})
        mock.get(GITHUB_EMAILS).respond(json=[])
        first = client.get("/v0/auth/github/callback", params={"code": "c", "state": sent})
        replay = client.get("/v0/auth/github/callback", params={"code": "c", "state": sent})
    assert first.headers["location"] == "https://app.mergit.test/app"
    assert replay.headers["location"].endswith("/signin?error=oauth_state")


def test_an_expired_state_is_rejected(client: TestClient, configured: Settings) -> None:
    start = client.get("/v0/auth/github/start")
    sent = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    with psycopg.connect(configured.database_url) as conn:
        conn.execute("UPDATE oauth_states SET expires_at = now() - interval '1 second'")
    response = client.get("/v0/auth/github/callback", params={"code": "c", "state": sent})
    assert response.headers["location"].endswith("/signin?error=oauth_state")


def test_a_state_issued_for_github_does_not_work_for_google(client: TestClient) -> None:
    start = client.get("/v0/auth/github/start")
    sent = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    response = client.get("/v0/auth/google/callback", params={"code": "c", "state": sent})
    assert response.headers["location"].endswith("/signin?error=oauth_state")


def test_the_provider_refusing_the_code_fails_the_login(client: TestClient) -> None:
    start = client.get("/v0/auth/github/start")
    sent = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    with respx.mock(assert_all_called=False) as mock:
        mock.post(GITHUB_TOKEN).respond(json={"error": "bad_verification_code"})
        response = client.get("/v0/auth/github/callback", params={"code": "c", "state": sent})
    assert response.headers["location"].endswith("/signin?error=oauth_failed")
    assert client.get("/v0/auth/me").status_code == 401


def test_the_user_denying_access_returns_to_sign_in(client: TestClient) -> None:
    client.get("/v0/auth/github/start")
    response = client.get("/v0/auth/github/callback", params={"error": "access_denied"})
    assert response.headers["location"].endswith("/signin?error=oauth_denied")


def test_google_login_creates_an_account(client: TestClient) -> None:
    response = google_login(client)
    assert response.headers["location"] == "https://app.mergit.test/app"
    profile = me(client)
    assert profile["name"] == "Gee Oogle"
    assert profile["email"] == "gee@example.com"
    assert profile["identities"] == [{"provider": "google", "label": "gee@example.com"}]


def test_google_login_refuses_an_unverified_email(client: TestClient) -> None:
    response = google_login(client, verified=False)
    assert response.headers["location"].endswith("/signin?error=email_unverified")
    assert client.get("/v0/auth/me").status_code == 401


def test_github_and_google_with_the_same_email_are_separate_accounts(client: TestClient) -> None:
    """No automatic merge by email: linking is explicit, while signed in."""
    github_login(client)
    first = me(client)["user_id"]
    client.cookies.clear()
    google_login(client)
    assert me(client)["user_id"] != first


def test_signed_in_user_can_link_github(client: TestClient) -> None:
    wallet = sign_in_with_wallet(client)
    user = me(client)["user_id"]
    response = github_login(client)
    assert response.headers["location"] == "https://app.mergit.test/app"
    profile = me(client)
    assert profile["user_id"] == user
    assert profile["address"] == wallet
    assert {"provider": "github", "label": "octo"} in profile["identities"]
    client.cookies.clear()
    github_login(client)
    assert me(client)["user_id"] == user


def test_linking_an_identity_that_belongs_to_another_user_is_refused(client: TestClient) -> None:
    github_login(client)
    owner = me(client)["user_id"]
    client.cookies.clear()
    sign_in_with_wallet(client)
    response = github_login(client)
    assert response.headers["location"].endswith("/signin?error=identity_taken")
    assert me(client)["user_id"] != owner


# --- email one-time codes -----------------------------------------------------------------------------


def test_email_code_signs_in(client: TestClient, outbox: Outbox) -> None:
    assert client.post("/v0/auth/email/start", json={"email": "Ada@Example.COM"}).status_code == 204
    to, _, _ = outbox.sent[0]
    assert to == "ada@example.com"
    response = client.post(
        "/v0/auth/email/verify", json={"email": "ada@example.com", "code": outbox.last_code()}
    )
    assert response.status_code == 200
    profile = me(client)
    assert profile["email"] == "ada@example.com"
    assert profile["identities"] == [{"provider": "email", "label": "ada@example.com"}]


def test_email_code_is_stored_hashed(client: TestClient, outbox: Outbox, configured: Settings) -> None:
    client.post("/v0/auth/email/start", json={"email": "ada@example.com"})
    with psycopg.connect(configured.database_url) as conn:
        stored = conn.execute("SELECT code_hash FROM email_otps").fetchone()
    assert stored
    assert outbox.last_code().encode() not in bytes(stored[0])


def test_wrong_email_code_is_rejected_and_locks_after_five_tries(client: TestClient, outbox: Outbox) -> None:
    client.post("/v0/auth/email/start", json={"email": "ada@example.com"})
    real = outbox.last_code()
    wrong = "000000" if real != "000000" else "111111"
    for _ in range(5):
        r = client.post("/v0/auth/email/verify", json={"email": "ada@example.com", "code": wrong})
        assert r.status_code == 401
    # The right code no longer works: the guesses used up the attempts.
    r = client.post("/v0/auth/email/verify", json={"email": "ada@example.com", "code": real})
    assert r.status_code == 401
    assert client.get("/v0/auth/me").status_code == 401


def test_email_code_is_single_use(client: TestClient, outbox: Outbox) -> None:
    client.post("/v0/auth/email/start", json={"email": "ada@example.com"})
    code = outbox.last_code()
    body = {"email": "ada@example.com", "code": code}
    assert client.post("/v0/auth/email/verify", json=body).status_code == 200
    client.cookies.clear()
    assert client.post("/v0/auth/email/verify", json=body).status_code == 401


def test_expired_email_code_is_rejected(client: TestClient, outbox: Outbox, configured: Settings) -> None:
    client.post("/v0/auth/email/start", json={"email": "ada@example.com"})
    with psycopg.connect(configured.database_url) as conn:
        conn.execute("UPDATE email_otps SET expires_at = now() - interval '1 second'")
    body = {"email": "ada@example.com", "code": outbox.last_code()}
    assert client.post("/v0/auth/email/verify", json=body).status_code == 401


def test_code_for_one_email_does_not_work_for_another(client: TestClient, outbox: Outbox) -> None:
    client.post("/v0/auth/email/start", json={"email": "ada@example.com"})
    body = {"email": "eve@example.com", "code": outbox.last_code()}
    assert client.post("/v0/auth/email/verify", json=body).status_code == 401


def test_a_new_code_replaces_the_old_one(client: TestClient, outbox: Outbox) -> None:
    client.post("/v0/auth/email/start", json={"email": "ada@example.com"})
    old = outbox.last_code()
    client.post("/v0/auth/email/start", json={"email": "ada@example.com"})
    if outbox.last_code() != old:  # one time in a million the two codes collide
        body = {"email": "ada@example.com", "code": old}
        assert client.post("/v0/auth/email/verify", json=body).status_code == 401


def test_email_sends_are_rate_limited(client: TestClient, outbox: Outbox) -> None:
    codes = [
        client.post("/v0/auth/email/start", json={"email": "ada@example.com"}).status_code for _ in range(7)
    ]
    assert codes[:5] == [204] * 5
    assert codes[5:] == [429, 429]
    assert len(outbox.sent) == 5


def test_email_must_look_like_an_email(client: TestClient, outbox: Outbox) -> None:
    for bad in ("", "nope", "a@b", "a b@c.de", "x" * 300 + "@c.de"):
        assert client.post("/v0/auth/email/start", json={"email": bad}).status_code == 422
    assert outbox.sent == []


# --- wallet: sign in, link, and the trial ---------------------------------------------------------------


def test_wallet_sign_in_has_a_user_and_the_same_wallet_the_same_user(client: TestClient) -> None:
    address, body = _signed(_nonce(client))
    client.post("/v0/auth/verify", json=body)
    first = me(client)
    assert first["address"] == address.lower()
    assert first["wallets"] == [address.lower()]
    assert first["identities"] == []
    assert first["user_id"]
    client.post("/v0/auth/logout")
    assert client.cookies.get("mergit_session") is None


def test_connecting_a_wallet_to_an_account_makes_it_the_acting_address(client: TestClient) -> None:
    github_login(client)
    before = me(client)
    address, body = _signed(_nonce(client))
    response = client.post("/v0/auth/wallet/link", json=body)
    assert response.status_code == 200, response.text
    after = me(client)
    assert after["user_id"] == before["user_id"]
    assert after["address"] == address.lower()
    assert after["wallets"] == [address.lower()]
    assert after["trial_address"] == before["trial_address"]


def test_linking_needs_a_session(client: TestClient) -> None:
    _, body = _signed(_nonce(client))
    assert client.post("/v0/auth/wallet/link", json=body).status_code == 401


def _signed_by(account: Account, nonce: str) -> dict[str, str]:
    message = SiweMessage.model_validate(
        {
            "domain": APP_DOMAIN,
            "address": account.address,
            "uri": f"https://{APP_DOMAIN}",
            "version": "1",
            "chain_id": 84532,
            "issued_at": _now(),
            "nonce": nonce,
        }
    ).prepare_message()
    signature = account.sign_message(encode_defunct(text=message)).signature.to_0x_hex()
    return {"message": message, "signature": signature}


def test_a_wallet_that_belongs_to_another_user_cannot_be_linked(client: TestClient) -> None:
    taken = Account.create()
    assert client.post("/v0/auth/verify", json=_signed_by(taken, _nonce(client))).status_code == 200
    owner = me(client)["user_id"]
    client.cookies.clear()
    github_login(client)
    mine = me(client)
    response = client.post("/v0/auth/wallet/link", json=_signed_by(taken, _nonce(client)))
    assert response.status_code == 409
    assert me(client) == mine  # nothing moved
    assert mine["user_id"] != owner


def test_trial_address_is_stable_per_user_and_not_a_wallet_anyone_holds() -> None:
    from uuid import UUID

    a = trial_address(UUID(int=1))
    assert a == trial_address(UUID(int=1))
    assert a != trial_address(UUID(int=2))
    assert re.fullmatch(r"0x[0-9a-f]{40}", a)


def test_starting_the_trial_is_idempotent(client: TestClient) -> None:
    github_login(client)
    first = client.post("/v0/account/trial")
    assert first.status_code == 200
    started = first.json()["started_at"]
    assert client.post("/v0/account/trial").json()["started_at"] == started
    assert me(client)["trial"] == {"started_at": started}


def test_an_account_without_a_wallet_cannot_draft_a_plan_before_the_trial(client: TestClient) -> None:
    github_login(client)
    response = client.post("/v0/plans", json=BODY)
    assert response.status_code == 403
    assert "trial" in response.json()["detail"]


def test_trial_user_drafts_and_approves_with_credits_only(client: TestClient) -> None:
    github_login(client)
    client.post("/v0/account/trial")
    plan = client.post("/v0/plans", json=BODY)
    assert plan.status_code == 201, plan.text
    assert plan.json()["requester"] == me(client)["trial_address"]
    uuid = plan.json()["plan_uuid"]
    tasks = {str(t["index"]): ["1"] for t in plan.json()["tasks"]}
    wallet = client.post(f"/v0/plans/{uuid}/approve", json={"agents": tasks, "funding": "wallet"})
    assert wallet.status_code == 422
    assert "credits" in json.dumps(wallet.json())
    credits = client.post(f"/v0/plans/{uuid}/approve", json={"agents": tasks, "funding": "credits"})
    assert credits.status_code == 200, credits.text


def test_plans_from_the_trial_stay_visible_after_a_wallet_is_connected(client: TestClient) -> None:
    github_login(client)
    client.post("/v0/account/trial")
    uuid = client.post("/v0/plans", json=BODY).json()["plan_uuid"]
    _, body = _signed(_nonce(client))
    assert client.post("/v0/auth/wallet/link", json=body).status_code == 200
    assert [p["plan_uuid"] for p in client.get("/v0/plans").json()] == [uuid]
    assert client.get(f"/v0/plans/{uuid}").status_code == 200


def test_another_user_cannot_see_the_trial_plan(client: TestClient) -> None:
    github_login(client)
    client.post("/v0/account/trial")
    uuid = client.post("/v0/plans", json=BODY).json()["plan_uuid"]
    client.cookies.clear()
    google_login(client)
    assert client.get(f"/v0/plans/{uuid}").status_code == 403
    assert client.get("/v0/plans").json() == []


# --- sign in vs create account ------------------------------------------------------------------------------


def test_signing_in_with_an_identity_nobody_registered_is_refused(client: TestClient) -> None:
    start = client.get("/v0/auth/github/start", params={"intent": "login"})
    sent = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    with respx.mock(assert_all_called=False) as mock:
        mock.post(GITHUB_TOKEN).respond(json={"access_token": "t"})
        mock.get(GITHUB_USER).respond(json={"id": 777, "login": "newcomer"})
        mock.get(GITHUB_EMAILS).respond(json=[])
        response = client.get("/v0/auth/github/callback", params={"code": "c", "state": sent})
    assert response.headers["location"].endswith("/signin?error=no_account")
    assert client.get("/v0/auth/me").status_code == 401
    # Nothing was created: registering with the same account afterwards makes the user, once.
    start = client.get("/v0/auth/github/start", params={"intent": "register"})
    sent = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    with respx.mock(assert_all_called=False) as mock:
        mock.post(GITHUB_TOKEN).respond(json={"access_token": "t"})
        mock.get(GITHUB_USER).respond(json={"id": 777, "login": "newcomer"})
        mock.get(GITHUB_EMAILS).respond(json=[])
        done = client.get("/v0/auth/github/callback", params={"code": "c", "state": sent})
    assert done.headers["location"] == "https://app.mergit.test/app"


def test_signing_in_with_a_registered_identity_works(client: TestClient) -> None:
    github_login(client)  # registers (the default intent creates)
    user = me(client)["user_id"]
    client.post("/v0/auth/logout")
    client.cookies.clear()
    start = client.get("/v0/auth/github/start", params={"intent": "login"})
    sent = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    with respx.mock(assert_all_called=False) as mock:
        mock.post(GITHUB_TOKEN).respond(json={"access_token": "t"})
        mock.get(GITHUB_USER).respond(json={"id": 4242, "login": "octo"})
        mock.get(GITHUB_EMAILS).respond(json=[])
        response = client.get("/v0/auth/github/callback", params={"code": "c", "state": sent})
    assert response.headers["location"] == "https://app.mergit.test/app"
    assert me(client)["user_id"] == user


def test_registering_with_an_identity_that_already_exists_just_signs_in(client: TestClient) -> None:
    github_login(client)
    user = me(client)["user_id"]
    client.cookies.clear()
    github_login(client)  # the default intent is register
    assert me(client)["user_id"] == user


def test_an_unknown_intent_is_rejected(client: TestClient) -> None:
    assert client.get("/v0/auth/github/start", params={"intent": "admin"}).status_code == 422


def test_email_sign_in_for_an_unregistered_address_is_refused_and_keeps_the_code(
    client: TestClient, outbox: Outbox
) -> None:
    client.post("/v0/auth/email/start", json={"email": "new@example.com"})
    code = outbox.last_code()
    body = {"email": "new@example.com", "code": code}
    refused = client.post("/v0/auth/email/verify", json=body | {"intent": "login"})
    assert refused.status_code == 404
    assert refused.json()["detail"] == "no_account"
    assert client.get("/v0/auth/me").status_code == 401
    # The code was not spent: creating the account with it still works.
    assert client.post("/v0/auth/email/verify", json=body | {"intent": "register"}).status_code == 200


def test_wallet_sign_in_for_an_unregistered_wallet_is_refused(client: TestClient) -> None:
    refused = client.post(
        "/v0/auth/verify", json=_signed_by(Account.create(), _nonce(client)) | {"intent": "login"}
    )
    assert refused.status_code == 404
    assert refused.json()["detail"] == "no_account"
    assert client.get("/v0/auth/me").status_code == 401


def test_wallet_sign_in_for_a_registered_wallet_works(client: TestClient) -> None:
    account = Account.create()
    client.post("/v0/auth/verify", json=_signed_by(account, _nonce(client)) | {"intent": "register"})
    user = me(client)["user_id"]
    client.cookies.clear()
    again = client.post("/v0/auth/verify", json=_signed_by(account, _nonce(client)) | {"intent": "login"})
    assert again.status_code == 200
    assert me(client)["user_id"] == user
