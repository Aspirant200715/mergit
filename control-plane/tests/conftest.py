from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from tests.support import ProcessSandbox, RecordingPublisher, make_repo


@pytest.fixture
def repo_url(tmp_path: Path) -> str:
    return make_repo(tmp_path)


@pytest.fixture
def sandbox(repo_url: str, tmp_path: Path) -> Iterator[ProcessSandbox]:
    sbx = ProcessSandbox.create(repo_url, "main", tmp_path / "ws")
    yield sbx
    sbx.destroy()


@pytest.fixture
def publisher() -> RecordingPublisher:
    return RecordingPublisher(sealed=[])
