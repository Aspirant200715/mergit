"""Model gateway client used by the harness. The worker only needs `complete`; the planner (O2) defines
the same protocol in `mergit_cp.llm`, and any object with this method satisfies both."""

from __future__ import annotations

import os
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol, cast

import anthropic
import httpx

from .config import ConfigError
from .openai_chat import BadReply, parse_reply, to_openai_messages, to_openai_tools
from .providers import require_provider


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


GROQ_BASE_URL = "https://api.groq.com/openai/v1"
_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
_ATTEMPTS = 3


def retry_wait(response: httpx.Response, attempt: int) -> float:
    """Seconds to wait before the next try: the provider's own `retry-after` when it sends one, capped at
    20."""
    try:
        return min(float(response.headers["retry-after"]), 20.0)
    except (KeyError, ValueError):
        return float(attempt)


class GroqLLM:
    """Groq's OpenAI-compatible chat API, the fallback when there is no Anthropic key. It takes and returns
    the same
    Anthropic-shaped data as `AnthropicLLM`, so the harness and the receipts do not know which one answered.
    The key
    is read from `GROQ_API_KEY` and is only ever in the `Authorization` header: errors never include it.

    Cached prompt tokens are counted as ordinary input here, because the worker's meter has no cached-token
    field:
    a receipt can overstate cost by at most the cache discount, never understate it."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        client: httpx.Client | None = None,
        timeout_s: float = 600.0,
        base_url: str = GROQ_BASE_URL,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        key = api_key or os.environ.get("GROQ_API_KEY")
        if not key:
            raise ConfigError("GROQ_API_KEY is not set")
        self._headers = {"Authorization": f"Bearer {key}"}
        self._url = f"{base_url.rstrip('/')}/chat/completions"
        self._http = client or httpx.Client(timeout=timeout_s)
        self._sleep = sleep

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        for attempt in range(1, _ATTEMPTS + 1):
            try:
                response = self._http.post(self._url, json=payload, headers=self._headers)
            except httpx.TransportError as exc:
                if attempt == _ATTEMPTS:
                    raise LLMError(f"model call failed: {type(exc).__name__}") from exc
                self._sleep(float(attempt))
                continue
            if response.status_code == 200:
                try:
                    return cast("dict[str, Any]", response.json())
                except ValueError as exc:
                    raise LLMError("model call failed: the answer is not JSON") from exc
            if response.status_code not in _RETRY_STATUSES or attempt == _ATTEMPTS:
                raise LLMError(f"model call failed: HTTP {response.status_code}: {response.text[:200]}")
            self._sleep(retry_wait(response, attempt))
        raise AssertionError("unreachable")  # pragma: no cover

    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        model: str,
        *,
        system: str | None = None,
        max_tokens: int = 8192,
    ) -> LLMResult:
        payload: dict[str, Any] = {
            "model": model,
            "messages": to_openai_messages(messages, system),
            "max_completion_tokens": max_tokens,
        }
        if tools:
            payload["tools"] = to_openai_tools(tools)
            payload["tool_choice"] = "auto"
        try:
            reply = parse_reply(self._post(payload))
        except BadReply as exc:
            raise LLMError(f"model call failed: {exc}") from exc
        blocks: list[dict[str, Any]] = [{"type": "text", "text": reply.text}] if reply.text else []
        blocks += [{"type": "tool_use", "id": i, "name": n, "input": a} for i, n, a in reply.calls]
        return LLMResult(
            text=reply.text,
            tool_calls=[ToolCall(i, n, a) for i, n, a in reply.calls],
            input_tokens=reply.prompt_tokens,
            output_tokens=reply.completion_tokens,
            model=reply.model or model,
            stop_reason=reply.stop_reason,
            assistant_content=blocks or [{"type": "text", "text": ""}],
        )


def build_llm(timeout_s: float, environ: Mapping[str, str] | None = None) -> LLM:
    """The model client for this deploy: Anthropic when its key is set, Groq when only Groq's is
    (providers.py)."""
    env = os.environ if environ is None else environ
    if require_provider(env) == "groq":
        return GroqLLM(env["GROQ_API_KEY"], timeout_s=timeout_s)
    return AnthropicLLM(timeout_s=timeout_s)
