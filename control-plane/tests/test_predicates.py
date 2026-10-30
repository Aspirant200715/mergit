"""Predicate checks at approval time. Every case but the pytest one must report a problem."""

from typing import Any

import pytest

from mergit_cp.predicates import check_predicate


def phi(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "kind": "exec/0",
        "command": ["pytest", "tests/test_refund.py", "-q"],
        "expected_exit": 0,
        "workdir": ".",
        "allowed_paths": ["payments/**"],
        "artifact_hashes": None,
        "timeout_s": 600,
    }
    return base | overrides


def test_accepts_pytest_predicate() -> None:
    assert check_predicate(phi()) == []


@pytest.mark.parametrize(
    "command",
    [
        ["true"],
        ["sh", "-c", "exit 0"],
        ["echo", "ok"],
        [":"],
        ["/usr/bin/true"],
        ["bash", "-c", "  true ; "],
        ["sh", "-c", "pytest -q || true"],
        ["sh", "-c", "pytest -q; exit 0"],
    ],
)
def test_rejects_trivial_predicate(command: list[str]) -> None:
    assert any("cannot fail" in p for p in check_predicate(phi(command=command)))


def test_rejects_false_expected_to_fail() -> None:
    assert check_predicate(phi(command=["false"], expected_exit=1))


def test_rejects_exit_with_the_expected_code() -> None:
    assert check_predicate(phi(command=["sh", "-c", "exit 3"], expected_exit=3))


@pytest.mark.parametrize("command", [[], [""]])
def test_rejects_empty_command(command: list[str]) -> None:
    assert check_predicate(phi(command=command))


@pytest.mark.parametrize("timeout_s", [0, 3601, -5])
def test_rejects_timeout_outside_range(timeout_s: int) -> None:
    assert check_predicate(phi(timeout_s=timeout_s))


@pytest.mark.parametrize("workdir", ["/etc", "../other", "a/../../b"])
def test_rejects_workdir_escaping_repo(workdir: str) -> None:
    assert check_predicate(phi(workdir=workdir))


def test_rejects_unknown_field_and_wrong_kind() -> None:
    assert check_predicate(phi(**{"use_shell": True}))
    assert check_predicate(phi(kind="exec/1"))


def test_rejects_bad_artifact_hash() -> None:
    assert check_predicate(phi(artifact_hashes={"out.txt": "0xNOTAHASH"}))


def test_rejects_non_object() -> None:
    assert check_predicate(["pytest"])  # pyright: ignore[reportArgumentType]
