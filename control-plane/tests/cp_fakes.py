"""Test doubles. Never imported by mergit_cp."""

from collections.abc import Sequence
from typing import Any

from mergit_cp.llm import LLMError, LLMResult


class FakeLLM:
    """Returns queued results in order; an LLMError in the queue is raised instead."""

    def __init__(self, outputs: Sequence[LLMResult | LLMError]) -> None:
        self._outputs = list(outputs)
        self.calls: list[dict[str, Any]] = []

    async def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        model: str,
        *,
        system: str | None = None,
        output_schema: dict[str, Any] | None = None,
    ) -> LLMResult:
        self.calls.append(
            {
                "messages": [dict(m) for m in messages],
                "model": model,
                "system": system,
                "schema": output_schema,
            }
        )
        out = self._outputs.pop(0)
        if isinstance(out, LLMError):
            raise out
        return out


def result(text: str, *, input_tokens: int = 1000, output_tokens: int = 500) -> LLMResult:
    return LLMResult(
        text=text,
        tool_calls=[],
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        model="claude-opus-5",
    )


class ListCostSink:
    def __init__(self) -> None:
        self.rows: list[tuple[str, LLMResult]] = []

    async def record(self, plan_uuid: str, usage: LLMResult) -> None:
        self.rows.append((plan_uuid, usage))
