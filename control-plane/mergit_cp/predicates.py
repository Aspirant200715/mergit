"""Approval-time checks on a predicate Φ (spec/predicate-v0.md).

``check_predicate`` validates against the spec's JSON Schema and rejects commands that cannot fail. That
second part is a guard against the commonest weak predicate, not a proof that a predicate is strong
(HLD R5): a requester still reads and approves every Φ.
"""

import re
import shlex
from pathlib import Path
from typing import Any

from .spec import schema_errors

_SHELLS = {"sh", "bash", "dash", "zsh", "ash"}
_ALWAYS_ZERO = {"true", ":", "echo"}
# A script whose last action forces success: `... || true`, `...; exit 0`, `...; :`.
_FORCED_ZERO_TAIL = re.compile(r"(\|\||;)\s*(true|:|exit\s+0)\s*;?\s*$")


def _unwrap_shell(command: list[str]) -> tuple[list[str], str | None]:
    """For ``[sh, -c, script]`` return the script's words and the script; otherwise the argv itself."""
    if len(command) >= 3 and Path(command[0]).name in _SHELLS and command[1] == "-c":
        script = command[2]
        try:
            return shlex.split(script.strip().rstrip(";")), script
        except ValueError:
            return [script], script
    return command, None


def _cannot_fail(command: list[str], expected_exit: int) -> bool:
    words, script = _unwrap_shell(command)
    if script is not None and expected_exit == 0 and _FORCED_ZERO_TAIL.search(script.strip()):
        return True
    if not words:
        return False
    name = Path(words[0]).name
    if name in _ALWAYS_ZERO and expected_exit == 0:
        return True
    if name == "false" and expected_exit == 1 and len(words) == 1:
        return True
    return name == "exit" and words[1:] == [str(expected_exit)]


def check_predicate(phi: dict[str, Any]) -> list[str]:
    """Problems with ``phi``, empty when it may be offered for approval."""
    problems = schema_errors("predicate", phi)
    if problems:
        return problems
    if _cannot_fail(phi["command"], phi["expected_exit"]):
        problems.append(
            f"command {phi['command']!r} cannot fail, so it says nothing about whether the task is done"
        )
    return problems
