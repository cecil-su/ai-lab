"""32-byte SQLCipher key storage + extraction stub.

Phase 1 reads use a key you provide manually (`wechat-use key set <hex>`).
Phase 2 will implement `extract_key()` (LLDB breakpoint / memory scan on Mac).
"""
from __future__ import annotations

import json
import os
import stat
from pathlib import Path

KEY_DIR = Path.home() / ".wx-rs"
KEY_FILE = KEY_DIR / "keys.json"


def _load() -> dict[str, str]:
    if KEY_FILE.exists():
        return json.loads(KEY_FILE.read_text())
    return {}


def get_key(account: str = "default") -> str | None:
    return _load().get(account)


def set_key(hex_key: str, account: str = "default") -> None:
    hex_key = hex_key.strip().lower()
    if hex_key.startswith("0x"):
        hex_key = hex_key[2:]
    if len(hex_key) != 64 or any(c not in "0123456789abcdef" for c in hex_key):
        raise ValueError("key must be 64 hex chars (32 bytes)")
    KEY_DIR.mkdir(mode=0o700, exist_ok=True)
    data = _load()
    data[account] = hex_key
    KEY_FILE.write_text(json.dumps(data, indent=2))
    os.chmod(KEY_FILE, stat.S_IRUSR | stat.S_IWUSR)  # 0600


def extract_key(account: str = "default") -> str:
    """Phase 2 entry. Delegates to the (macOS-only) lldb skeleton.

    Until implemented, grab the key manually via LLDB on the Mac and run:
        wechat-use key set <64-hex>
    Blueprint: docs/designs/2026-06-24-wechat-use-replicate.md (取 key).
    """
    from . import keyextract  # lazy: avoids importing on every CLI call

    key = keyextract.extract_key()
    set_key(key, account)
    return key
