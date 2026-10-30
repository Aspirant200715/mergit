from __future__ import annotations

import pytest
from pydantic import SecretStr

from mergit_worker.__main__ import build_progress_reporter
from mergit_worker.config import WorkerConfig
from mergit_worker.progress import HttpProgressReporter, NullProgressReporter

BASE = {
    "database_url": "postgres://x",
    "gateway_url": "http://g",
    "store_url": "http://s",
    "events_token": "e",
    "store_write_token": "s",
    "receipt_registry": "0x" + "1" * 40,
}


def cfg(**over: object) -> WorkerConfig:
    return WorkerConfig(agents_file="unused", **BASE, **over)  # type: ignore[arg-type]


def test_both_set_gives_an_http_reporter() -> None:
    reporter = build_progress_reporter(cfg(control_plane_url="http://cp.test", worker_token=SecretStr("w")))
    assert isinstance(reporter, HttpProgressReporter)


def test_neither_set_gives_a_null_reporter() -> None:
    assert isinstance(build_progress_reporter(cfg()), NullProgressReporter)


@pytest.mark.parametrize("over", [{"control_plane_url": "http://cp.test"}, {"worker_token": SecretStr("w")}])
def test_only_one_set_also_gives_a_null_reporter(over: dict[str, object]) -> None:
    assert isinstance(build_progress_reporter(cfg(**over)), NullProgressReporter)
