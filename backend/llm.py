"""
LLM client — thin wrapper around the OpenAI-compatible API exposed by LM Studio.
Supports streaming with reasoning_content + content tokens, with a non-streaming
fallback if the streamed response is empty (mirrors the original app.py logic).
"""

from __future__ import annotations

from typing import Generator, List

from openai import OpenAI

from backend.config import (
    LLM_API_KEY,
    LLM_BASE_URL,
    LLM_MAX_TOKENS,
    LLM_MODEL,
    LLM_REASONING_EFFORT,
    LLM_TEMPERATURE,
)

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY)
    return _client


def stream_chat(messages: List[dict]) -> Generator[dict, None, None]:
    """
    Stream a chat completion.

    Yields dicts of the form:
        {"type": "thinking", "content": "…"}
        {"type": "content", "content": "…"}
        {"type": "done",     "content": "…"}   ← full assembled reply

    If the stream produces no visible content, falls back to a non-streaming
    call and yields a single "content" + "done" event.
    """
    client = _get_client()

    response = client.chat.completions.create(
        model=LLM_MODEL,
        messages=messages,
        temperature=LLM_TEMPERATURE,
        max_tokens=LLM_MAX_TOKENS,
        reasoning_effort=LLM_REASONING_EFFORT,
        stream=True,
    )

    full_content = ""
    full_thinking = ""

    for chunk in response:
        if not hasattr(chunk, "choices") or len(chunk.choices) == 0:
            continue

        delta = chunk.choices[0].delta
        reasoning = getattr(delta, "reasoning_content", None)
        content = getattr(delta, "content", None)

        if reasoning:
            full_thinking += reasoning
            yield {"type": "thinking", "content": reasoning}

        if content:
            full_content += content
            yield {"type": "content", "content": content}

    # Fallback: some reasoning models stream only reasoning_content
    if not full_content.strip():
        fallback = client.chat.completions.create(
            model=LLM_MODEL,
            messages=messages,
            temperature=LLM_TEMPERATURE,
            max_tokens=LLM_MAX_TOKENS,
            reasoning_effort=LLM_REASONING_EFFORT,
            stream=False,
        )
        full_content = fallback.choices[0].message.content or ""
        if full_content:
            yield {"type": "content", "content": full_content}

    yield {"type": "done", "content": full_content, "thinking": full_thinking}
