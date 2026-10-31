""" "Notify me" for wallets Mergit does not support yet: a demand signal, not a verified count.

Signed-in people are counted by account (so they can be told at launch); signed-out people by a random token
the browser keeps. Run with `pytest -m postgres`.
"""

from __future__ import annotations

from collections.abc import Iterator

import psycopg
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from mergit_cp.app import create_app
from mergit_cp.config import Settings
from mergit_cp.wallet_interest import WALLETS, interest_counts
from tests.test_accounts import Outbox, github_login

pytestmark = pytest.mark.postgres

TOKEN = "a" * 32


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    limited = settings.model_copy(
        update={
            "wallet_interest_per_minute": 5,
            "github_client_id": "gh-id",
            "github_client_secret": SecretStr("s"),
        }
    )
    with TestClient(
        create_app(limited, deliver_events=False, mailer=Outbox()),
        base_url="https://testserver",
        follow_redirects=False,
    ) as c:
        yield c
    with psycopg.connect(settings.database_url) as conn:
        tables = conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'"
        ).fetchall()
        conn.execute("TRUNCATE " + ", ".join(t[0] for t in tables) + " CASCADE")


def rows(settings: Settings) -> list[tuple[object, ...]]:
    with psycopg.connect(settings.database_url) as conn:
        return conn.execute(
            "SELECT wallet, user_id IS NOT NULL, anon_token FROM wallet_interest ORDER BY wallet"
        ).fetchall()


def test_the_wallets_on_offer_are_fixed() -> None:
    assert set(WALLETS) == {"coinbase", "coindcx", "trust", "phantom", "rabby", "other"}


def test_a_signed_out_visitor_is_counted_once_per_wallet(client: TestClient, settings: Settings) -> None:
    body = {"wallets": ["coindcx"], "token": TOKEN}
    assert client.post("/v0/wallet-interest", json=body).status_code == 204
    assert (
        client.post("/v0/wallet-interest", json=body).status_code == 204
    )  # clicking again is not a second vote
    assert rows(settings) == [("coindcx", False, TOKEN)]


def test_several_wallets_at_once_and_duplicates_collapse(client: TestClient, settings: Settings) -> None:
    body = {"wallets": ["trust", "rabby", "trust"], "token": TOKEN}
    assert client.post("/v0/wallet-interest", json=body).status_code == 204
    assert [r[0] for r in rows(settings)] == ["rabby", "trust"]


def test_a_signed_in_user_is_counted_by_account_not_by_token(client: TestClient, settings: Settings) -> None:
    from tests.test_accounts import me

    github_login(client)
    assert (
        client.post("/v0/wallet-interest", json={"wallets": ["coindcx"], "token": TOKEN}).status_code == 204
    )
    assert (
        client.post("/v0/wallet-interest", json={"wallets": ["coindcx"], "token": "b" * 32}).status_code
        == 204
    )
    assert rows(settings) == [("coindcx", True, None)]  # one account, however many browsers
    assert me(client)["user_id"]


def test_a_signed_in_user_needs_no_token(client: TestClient, settings: Settings) -> None:
    github_login(client)
    assert client.post("/v0/wallet-interest", json={"wallets": ["phantom"]}).status_code == 204
    assert rows(settings) == [("phantom", True, None)]


def test_a_wallet_that_is_not_on_offer_is_refused(client: TestClient, settings: Settings) -> None:
    assert (
        client.post("/v0/wallet-interest", json={"wallets": ["<script>"], "token": TOKEN}).status_code == 422
    )
    assert rows(settings) == []


def test_the_list_must_have_between_one_and_six_wallets(client: TestClient) -> None:
    assert client.post("/v0/wallet-interest", json={"wallets": [], "token": TOKEN}).status_code == 422
    seven = ["coinbase", "coindcx", "trust", "phantom", "rabby", "other", "coinbase"]
    assert client.post("/v0/wallet-interest", json={"wallets": seven, "token": TOKEN}).status_code == 422


def test_a_signed_out_visitor_needs_a_real_token(client: TestClient) -> None:
    assert client.post("/v0/wallet-interest", json={"wallets": ["trust"]}).status_code == 422
    assert (
        client.post("/v0/wallet-interest", json={"wallets": ["trust"], "token": "short"}).status_code == 422
    )
    assert (
        client.post("/v0/wallet-interest", json={"wallets": ["trust"], "token": "x" * 200}).status_code == 422
    )
    assert (
        client.post(
            "/v0/wallet-interest", json={"wallets": ["trust"], "token": "bad token!!" * 4}
        ).status_code
        == 422
    )


def test_a_flood_of_new_tokens_is_slowed_down(client: TestClient, settings: Settings) -> None:
    codes = [
        client.post("/v0/wallet-interest", json={"wallets": ["trust"], "token": f"{i:032d}"}).status_code
        for i in range(8)
    ]
    assert codes[:5] == [204] * 5
    assert codes[5:] == [429] * 3
    assert len(rows(settings)) == 5


def test_counts_are_people_not_clicks(client: TestClient, settings: Settings) -> None:
    client.post("/v0/wallet-interest", json={"wallets": ["coindcx", "trust"], "token": "a" * 32})
    client.post("/v0/wallet-interest", json={"wallets": ["coindcx"], "token": "b" * 32})
    github_login(client)
    client.post("/v0/wallet-interest", json={"wallets": ["coindcx"]})
    with psycopg.connect(settings.database_url) as conn:
        assert interest_counts(conn) == {"coindcx": (3, 1), "trust": (1, 0)}
