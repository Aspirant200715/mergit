"""The Anthropic-shaped messages the harness keeps (and records in receipts) translate to and from the OpenAI
chat
shape that Groq speaks, without losing a tool call or a tool result."""

from __future__ import annotations

import json

import pytest

from mergit_worker.openai_chat import BadReply, parse_reply, to_openai_messages, to_openai_tools

TOOLS = [
    {
        "name": "read_file",
        "description": "Read a file",
        "input_schema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
    }
]


def test_tools_become_function_tools_with_the_same_schema():
    assert to_openai_tools(TOOLS) == [
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read a file",
                "parameters": TOOLS[0]["input_schema"],
            },
        }
    ]


def test_a_plain_conversation_keeps_its_order_and_gets_the_system_prompt_first():
    out = to_openai_messages([{"role": "user", "content": "fix it"}], "be careful")
    assert out == [{"role": "system", "content": "be careful"}, {"role": "user", "content": "fix it"}]


def test_no_system_prompt_adds_no_system_message():
    assert to_openai_messages([{"role": "user", "content": "hi"}], None) == [
        {"role": "user", "content": "hi"}
    ]


def test_an_assistant_tool_use_turn_and_its_result_round_trip():
    messages = [
        {"role": "user", "content": "fix it"},
        {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "Reading."},
                {"type": "tool_use", "id": "call_1", "name": "read_file", "input": {"path": "a.py"}},
            ],
        },
        {
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": "call_1", "content": "print(1)", "is_error": False}
            ],
        },
    ]
    out = to_openai_messages(messages, None)
    assert out[1] == {
        "role": "assistant",
        "content": "Reading.",
        "tool_calls": [
            {
                "id": "call_1",
                "type": "function",
                "function": {"name": "read_file", "arguments": '{"path": "a.py"}'},
            }
        ],
    }
    # `name` is deliberately absent: Groq's compatibility page lists messages[].name as a 400.
    assert out[2] == {"role": "tool", "tool_call_id": "call_1", "content": "print(1)"}


def test_an_assistant_turn_with_only_tool_calls_has_null_content():
    out = to_openai_messages(
        [
            {
                "role": "assistant",
                "content": [{"type": "tool_use", "id": "c", "name": "read_file", "input": {}}],
            }
        ],
        None,
    )
    assert out[0]["content"] is None and len(out[0]["tool_calls"]) == 1


def test_one_user_turn_with_several_results_becomes_one_tool_message_each_in_order():
    out = to_openai_messages(
        [
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "a", "content": "one", "is_error": False},
                    {"type": "tool_result", "tool_use_id": "b", "content": "two", "is_error": False},
                ],
            }
        ],
        None,
    )
    assert [(m["role"], m["tool_call_id"], m["content"]) for m in out] == [
        ("tool", "a", "one"),
        ("tool", "b", "two"),
    ]


def test_a_failed_tool_result_says_so_because_the_openai_shape_has_no_error_flag():
    out = to_openai_messages(
        [
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "a", "content": "no such file", "is_error": True}
                ],
            }
        ],
        None,
    )
    assert out[0]["content"] == "Error: no such file"


def test_tool_result_content_given_as_blocks_is_flattened_to_text():
    out = to_openai_messages(
        [
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "a",
                        "content": [{"type": "text", "text": "x"}, {"type": "text", "text": "y"}],
                        "is_error": False,
                    }
                ],
            }
        ],
        None,
    )
    assert out[0]["content"] == "xy"


def _reply(message: dict[str, object], finish: str = "stop", usage: dict[str, object] | None = None):
    return {
        "model": "openai/gpt-oss-120b",
        "choices": [{"message": {"role": "assistant", **message}, "finish_reason": finish}],
        "usage": usage or {"prompt_tokens": 10, "completion_tokens": 5},
    }


def test_a_text_reply_is_parsed_with_its_usage():
    r = parse_reply(_reply({"content": "done"}, usage={"prompt_tokens": 100, "completion_tokens": 7}))
    assert (r.text, r.calls, r.stop_reason, r.prompt_tokens, r.completion_tokens, r.cached_tokens) == (
        "done",
        [],
        "end_turn",
        100,
        7,
        0,
    )


def test_tool_call_arguments_arrive_as_a_json_string_and_are_parsed():
    r = parse_reply(
        _reply(
            {
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_9",
                        "type": "function",
                        "function": {"name": "read_file", "arguments": '{"path": "b.py"}'},
                    }
                ],
            },
            finish="tool_calls",
        )
    )
    assert r.calls == [("call_9", "read_file", {"path": "b.py"})]
    assert r.text == "" and r.stop_reason == "tool_use"


def test_cached_prompt_tokens_are_reported_separately():
    r = parse_reply(
        _reply(
            {"content": "x"},
            usage={
                "prompt_tokens": 100,
                "completion_tokens": 1,
                "prompt_tokens_details": {"cached_tokens": 60},
            },
        )
    )
    assert r.prompt_tokens == 100 and r.cached_tokens == 60


@pytest.mark.parametrize(
    ("finish", "expected"),
    [
        ("stop", "end_turn"),
        ("tool_calls", "tool_use"),
        ("length", "max_tokens"),
        ("content_filter", "refusal"),
    ],
)
def test_finish_reasons_map_to_the_harness_stop_reasons(finish: str, expected: str):
    assert parse_reply(_reply({"content": "x"}, finish=finish)).stop_reason == expected


def test_an_unknown_finish_reason_is_passed_through_not_hidden():
    assert parse_reply(_reply({"content": "x"}, finish="something_new")).stop_reason == "something_new"


def test_tool_arguments_that_are_not_json_are_an_error_not_an_empty_call():
    bad = _reply(
        {
            "content": None,
            "tool_calls": [{"id": "c", "type": "function", "function": {"name": "t", "arguments": "{oops"}}],
        },
        finish="tool_calls",
    )
    with pytest.raises(BadReply, match="arguments"):
        parse_reply(bad)


def test_a_reply_with_no_choices_is_an_error():
    with pytest.raises(BadReply):
        parse_reply({"choices": [], "usage": {}})


def test_arguments_json_round_trips_through_the_message_shape():
    original = {"path": "a/b.py", "n": 3, "flag": True}
    out = to_openai_messages(
        [{"role": "assistant", "content": [{"type": "tool_use", "id": "c", "name": "t", "input": original}]}],
        None,
    )
    assert json.loads(out[0]["tool_calls"][0]["function"]["arguments"]) == original
