"""Model gateway: one small interface the planner and the agents call, with an Anthropic adapter.

Nothing outside this module imports a provider SDK, so adding a provider is one more class here.
Credentials come from the provider SDK's own environment lookup and never pass through a prompt.
"""

from dataclasses import dataclass, field
from typing import Any, Protocol, cast

from anthropic import APIError, AsyncAnthropic, omit
from anthropic.types import Message, MessageParam, ToolParam


@dataclass(frozen=True)
class LLMResult:
    text: str
    tool_calls: list[dict[str, Any]]
    input_tokens: int
    output_tokens: int
    model: str
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0


@dataclass
class LLMError(Exception):
    """The model answered but the answer is unusable. ``usage`` is still billed and must be recorded."""

    reason: str
    usage: LLMResult = field(repr=False)

    def __str__(self) -> str:
        return f"model stopped with {self.reason}"


class LLMUnavailable(Exception):
    """The provider could not be reached or answered with an error after the SDK's own retries."""


class LLM(Protocol):
    async def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        model: str,
        *,
        system: str | None = None,
        output_schema: dict[str, Any] | None = None,
    ) -> LLMResult: ...


_UNUSABLE = {"refusal", "max_tokens"}


class AnthropicLLM:
    def __init__(self, client: AsyncAnthropic | None = None, *, max_tokens: int = 16000) -> None:
        self._client = client or AsyncAnthropic()
        self._max_tokens = max_tokens

    async def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        model: str,
        *,
        system: str | None = None,
        output_schema: dict[str, Any] | None = None,
    ) -> LLMResult:
        try:
            response = await self._create(messages, tools, model, system, output_schema)
        except APIError as exc:
            raise LLMUnavailable(f"{type(exc).__name__}: {exc}") from exc
        usage = response.usage
        result = LLMResult(
            text="".join(block.text for block in response.content if block.type == "text"),
            tool_calls=[
                {"id": block.id, "name": block.name, "input": block.input}
                for block in response.content
                if block.type == "tool_use"
            ],
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cache_read_tokens=usage.cache_read_input_tokens or 0,
            cache_write_tokens=usage.cache_creation_input_tokens or 0,
            model=response.model,
        )
        if response.stop_reason in _UNUSABLE:
            raise LLMError(str(response.stop_reason), result)
        return result

    async def _create(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        model: str,
        system: str | None,
        output_schema: dict[str, Any] | None,
    ) -> Message:
        return await self._client.messages.create(
            model=model,
            max_tokens=self._max_tokens,
            # Callers build plain dicts in the API's own shape; the SDK sends them unchanged.
            messages=cast(list[MessageParam], messages),
            system=system if system is not None else omit,
            tools=cast(list[ToolParam], tools) if tools else omit,
            output_config=(
                {"format": {"type": "json_schema", "schema": output_schema}}
                if output_schema is not None
                else omit
            ),
        )
