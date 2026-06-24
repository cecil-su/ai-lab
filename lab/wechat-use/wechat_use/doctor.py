"""Phase 0 environment checks."""
from __future__ import annotations

import platform
import shutil
import subprocess
import sys
from pathlib import Path

from . import keystore, paths, sqlcipher

WECHAT_APP = Path("/Applications/WeChat.app")
WECHAT_BIN = WECHAT_APP / "Contents/MacOS/WeChat"


def _devtools_status() -> tuple[bool, str]:
    if not paths.is_macos():
        return False, "skip (not macOS)"
    if not shutil.which("DevToolsSecurity"):
        return False, "DevToolsSecurity not found"
    try:
        out = subprocess.run(
            ["DevToolsSecurity", "-status"], capture_output=True, text=True, timeout=5
        ).stdout.strip()
    except Exception as e:  # noqa: BLE001
        return False, f"error: {e}"
    return ("enabled" in out.lower()), out or "unknown"


def _wechat_running() -> tuple[bool, str]:
    if not shutil.which("pgrep"):
        return False, "skip (no pgrep)"
    ok = subprocess.run(["pgrep", "-x", "WeChat"], capture_output=True).returncode == 0
    return ok, "running" if ok else "not running"


def run() -> list[dict]:
    """Return a list of {check, ok, detail} rows."""
    checks: list[dict] = []

    def add(name: str, ok: bool, detail: str) -> None:
        checks.append({"check": name, "ok": ok, "detail": detail})

    add("platform", paths.is_macos(), platform.platform())
    add("python", sys.version_info >= (3, 11), sys.version.split()[0])
    add("sqlcipher CLI", sqlcipher.have_sqlcipher(),
        shutil.which("sqlcipher") or "not on PATH (brew install sqlcipher)")
    add("WeChat.app", WECHAT_BIN.exists(), str(WECHAT_BIN))

    running, detail = _wechat_running()
    add("WeChat running", running, detail)

    dt_ok, dt_detail = _devtools_status()
    add("DevToolsSecurity", dt_ok, dt_detail)

    root = paths.container_root()
    add("WeChat container", root.exists(), str(root))

    dbs = paths.find_message_dbs()
    add("DB files found", bool(dbs), f"{len(dbs)} file(s)")

    key = keystore.get_key()
    add("cached key", key is not None,
        "present" if key else "none (wechat-use key set <hex>)")

    return checks
