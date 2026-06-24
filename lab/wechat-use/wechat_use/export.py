"""Render message rows to JSON / Markdown.

Pure formatting, schema-tolerant: real column names are unknown until verified
on the Mac, so we pick the first matching candidate key and fall back gracefully.
Fully testable without a real DB.
"""
from __future__ import annotations

import json

_TIME_KEYS = ("display_time", "create_time", "createTime", "time", "timestamp")
_SENDER_KEYS = ("sender_name", "senderName", "sender", "real_sender", "from")
_TEXT_KEYS = ("display_text", "content", "text", "body", "message")


def _pick(row: dict, candidates: tuple[str, ...]) -> object | None:
    for k in candidates:
        if k in row and row[k] not in (None, ""):
            return row[k]
    return None


def to_json(rows: list[dict]) -> str:
    return json.dumps(rows, ensure_ascii=False, indent=2, default=str)


def to_markdown(rows: list[dict], *, title: str | None = None) -> str:
    lines: list[str] = []
    if title:
        lines.append(f"# {title}\n")
    for row in rows:
        time = _pick(row, _TIME_KEYS)
        sender = _pick(row, _SENDER_KEYS)
        text = _pick(row, _TEXT_KEYS)
        if text is None:
            # Nothing recognizable — dump the row compactly so data isn't lost.
            lines.append(f"- `{json.dumps(row, ensure_ascii=False, default=str)}`")
            continue
        prefix = []
        if time is not None:
            prefix.append(f"[{time}]")
        if sender is not None:
            prefix.append(f"**{sender}**")
        head = " ".join(prefix)
        lines.append(f"- {head}: {text}" if head else f"- {text}")
    return "\n".join(lines) + "\n"
