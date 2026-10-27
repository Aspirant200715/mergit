"""Model gateway client used by the harness. The worker only needs `complete`; the planner (O2) defines
the same protocol in `mergit_cp.llm`, and any object with this method satisfies both."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, cast

import anthropic


class LLMError(Exception):
    """The provider call failed after the SDK's own retries."""


@dataclass(frozen=True, slots=True)
class ToolCall:
    id: str
    name: str
    input: dict[str, Any]


@dataclass(frozen=True, slots=True)
class LLMResult:
    text: str
    tool_calls: list[ToolCall]
    input_tokens: int
    output_tokens: int
    model: str
    stop_reason: str | None = None
    # The assistant turn as the provider returned it, so the next request can replay it unchanged.
    assistant_content: list[dict[str, Any]] = field(default_factory=lambda: [])


class LLM(Protocol):
    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        model: str,
        *,
        system: str | None = None,
        max_tokens: int = 8192,
    ) -> LLMResult: ...


class AnthropicLLM:
    """Anthropic Messages API through the official SDK. The key is read from `ANTHROPIC_API_KEY` by the
    SDK, in the worker's environment only."""

    def __init__(self, client: anthropic.Anthropic | None = None, timeout_s: float = 600.0) -> None:
        self._client = client or anthropic.Anthropic(timeout=timeout_s)

    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        model: str,
        *,
        system: str | None = None,
        max_tokens: int = 8192,
    ) -> LLMResult:
        kwargs: dict[str, Any] = {"model": model, "max_tokens": max_tokens, "messages": messages}
        if system:
            kwargs["system"] = system
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = {"type": "auto"}
        try:
            response = cast("anthropic.types.Message", self._client.messages.create(**kwargs))
        except anthropic.APIError as exc:
            raise LLMError(f"model call failed: {exc}") from exc
        blocks = [b.model_dump(exclude_none=True) for b in response.content]
        text = "".join(b.text for b in response.content if b.type == "text")
        calls = [
            ToolCall(b.id, b.name, dict(b.input))  # pyright: ignore[reportArgumentType]
            for b in response.content
            if b.type == "tool_use"
        ]
        return LLMResult(
            text=text,
            tool_calls=calls,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            model=response.model,
            stop_reason=response.stop_reason,
            assistant_content=blocks,
        )
