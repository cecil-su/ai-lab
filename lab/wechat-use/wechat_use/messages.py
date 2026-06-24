"""Message helpers: per-chat table name, content decode, history.

⚠️ SCHEMA UNVERIFIED. The table name pattern (`Msg_<md5(chat_wxid)>`) and the
content encoding (zstd + group `<sender>:\n` prefix) come from upstream docs,
not from a confirmed 4.x schema. On the Mac, run `wechat-use tables` /
`wechat-use schema <table>` first, then fix `MSG_TABLE_*` / column names below.
"""
from __future__ import annotations

import hashlib

from . import sqlcipher


def msg_table_name(chat_wxid: str) -> str:
    """Upstream: messages live in `Msg_<md5(chat_wxid)>`. Hash of the utf-8 wxid."""
    digest = hashlib.md5(chat_wxid.encode("utf-8")).hexdigest()
    return f"Msg_{digest}"


def decode_content(raw: object, *, is_hex: bool = False) -> str:
    """Best-effort decode of a message `content` field.

    Handles: bytes/str, hex-encoded bytes (`is_hex=True`, e.g. from
    `SELECT hex(content)` — the robust way to pull BLOBs through `.mode json`),
    zstd compression (if `zstandard` installed), and the group `<sender_wxid>:\\n`
    prefix. Returns the text unchanged on any miss.
    """
    data: bytes
    if is_hex and isinstance(raw, str):
        try:
            data = bytes.fromhex(raw.strip())
        except ValueError:
            return raw
    elif isinstance(raw, bytes):
        data = raw
    elif isinstance(raw, str):
        try:
            data = raw.encode("utf-8")
        except Exception:
            return raw
    else:
        return "" if raw is None else str(raw)

    # zstd magic number: 0x28 0xB5 0x2F 0xFD
    if data[:4] == b"\x28\xb5\x2f\xfd":
        try:
            import zstandard  # optional dep

            data = zstandard.ZstdDecompressor().decompress(data)
        except ModuleNotFoundError:
            return "[zstd content — `pip install zstandard` to decode]"
        except Exception:
            pass  # fall through with raw bytes

    text = data.decode("utf-8", errors="replace")

    # Strip group prefix "wxid_xxx:\n"
    head, sep, tail = text.partition(":\n")
    if sep and "\n" not in head and len(head) < 64:
        return tail
    return text


def history(db_path, key_hex: str, chat_wxid: str, limit: int = 50) -> list[dict]:
    """Recent messages for one chat, newest first.

    ⚠️ Column names assumed (`create_time`, `content`). Verify on Mac and adjust.
    """
    table = msg_table_name(chat_wxid)
    rows = sqlcipher.query(
        db_path, key_hex,
        f"SELECT * FROM {table} ORDER BY create_time DESC LIMIT {int(limit)}",
    )
    for r in rows:
        if "content" in r:
            r["display_text"] = decode_content(r["content"])
    return rows
