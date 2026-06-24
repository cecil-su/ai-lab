"""WeChat container / database path discovery."""
from __future__ import annotations

import platform
from pathlib import Path

CONTAINER = "Library/Containers/com.tencent.xinWeChat/Data"


def is_macos() -> bool:
    return platform.system() == "Darwin"


def container_root() -> Path:
    return Path.home() / CONTAINER


def find_message_dbs() -> list[Path]:
    """All .db files under the WeChat container (candidates — eyeball on Mac to
    pick the real message DBs; the exact layout is UNVERIFIED)."""
    root = container_root()
    if not root.exists():
        return []
    return sorted(p for p in root.rglob("*.db") if p.is_file())
