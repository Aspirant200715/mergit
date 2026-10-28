"""The Anthropic adapter, against a stand-in for the SDK client (no network, no key)."""

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from mergit_cp.llm import AnthropicLLM, LLMError, LLMUnavailable


class StubMessages:
    def __init__(self, response: Any) -> None:
        self.response = response
        self.kwargs: dict[str, Any] = {}

    async def create(self, **kwargs: Any) -> Any:
        self.kwargs = kwargs
        return self.response


def response(stop_reason: str = "end_turn", **usage: int) -> SimpleNamespace:
    counts = {
        "input_tokens": 120,
        "output_tokens": 40,
        "cache_read_input_tokens": None,
        "cache_creation_input_tokens": None,
    }
    return SimpleNamespace(
        model="claude-opus-5",
        stop_reason=stop_reason,
        content=[
            SimpleNamespace(type="thinking", thinking=""),
            SimpleNamespace(type="text", text='{"tasks": []}'),
            SimpleNamespace(type="tool_use", id="tu_1", name="read_file", input={"path": "a.py"}),
        ],
        usage=SimpleNamespace(**(counts | usage)),
    )


def complete(stub: StubMessages, **kwargs: Any):
    llm = AnthropicLLM(SimpleNamespace(messages=stub), max_tokens=16000)  # pyright: ignore[reportArgumentType]
    return asyncio.run(llm.complete([{"role": "user", "content": "plan"}], None, "claude-opus-5", **kwargs))


def test_maps_text_tool_calls_and_usage() -> None:
    out = complete(StubMessages(response(cache_read_input_tokens=7)))
    assert out.text == '{"tasks": []}'
    assert out.tool_calls == [{"id": "tu_1", "name": "read_file", "input": {"path": "a.py"}}]
    assert (out.input_tokens, out.output_tokens, out.cache_read_tokens, out.cache_write_tokens) == (
        120,
        40,
        7,
        0,
    )


def test_sends_schema_as_structured_output_and_no_sampling_params() -> None:
    stub = StubMessages(response())
    complete(stub, system="be brief", output_schema={"type": "object"})
    assert stub.kwargs["output_config"] == {"format": {"type": "json_schema", "schema": {"type": "object"}}}
    assert stub.kwargs["system"] == "be brief"
    assert not {"temperature", "top_p", "top_k"} & stub.kwargs.keys()


@pytest.mark.parametrize("stop_reason", ["refusal", "max_tokens"])
def test_unusable_stop_raises_but_keeps_usage(stop_reason: str) -> None:
    with pytest.raises(LLMError) as err:
        complete(StubMessages(response(stop_reason)))
    assert err.value.reason == stop_reason
    assert err.value.usage.input_tokens == 120


def test_provider_error_becomes_llm_unavailable() -> None:
    import anthropic
    import httpx2

    class Down:
        async def create(self, **kwargs: Any) -> Any:
            raise anthropic.APIConnectionError(request=httpx2.Request("POST", "https://api.anthropic.com"))

    llm = AnthropicLLM(SimpleNamespace(messages=Down()))  # pyright: ignore[reportArgumentType]
    with pytest.raises(LLMUnavailable):
        asyncio.run(llm.complete([{"role": "user", "content": "x"}], None, "claude-opus-5"))
