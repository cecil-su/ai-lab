"""Phase 2 — SQLCipher key extraction (macOS only, NOT YET IMPLEMENTED).

This is an honest skeleton. The actual LLDB driving only runs on the target Mac
and is left as TODO. Two routes, picked per WeChat build:

  - **LLDB breakpoint** (<= 4.1.8): break at the key-write offset, read the
    32-byte raw key from a register the instant it's written at login.
  - **Memory scan** (4.1.9+): scan the process heap for the key.

Offsets drift per build, so they live in a fingerprint -> profile table
(`OFFSETS`), keyed by the SHA-256 of the relevant dylib/binary.升级时只改这张表。

Prereqs handled by `init` (also TODO, macOS):
  sudo DevToolsSecurity -enable
  sudo codesign --force --sign - --entitlements <get-task-allow.plist> \
       /Applications/WeChat.app/Contents/MacOS/WeChat
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

WECHAT_BIN = Path("/Applications/WeChat.app/Contents/MacOS/WeChat")


@dataclass(frozen=True)
class Profile:
    """How to extract the key for one WeChat build."""
    build: str
    route: str               # "breakpoint" | "memscan"
    key_write_offset: int | None = None   # for breakpoint route
    register: str | None = None           # e.g. "x1" — where the key ptr sits


# fingerprint(sha256 hex) -> Profile. Fill in as builds are reversed on Mac.
OFFSETS: dict[str, Profile] = {}


def fingerprint(binary: Path = WECHAT_BIN) -> str:
    """SHA-256 of the WeChat binary — the lookup key into OFFSETS. Runs anywhere."""
    h = hashlib.sha256()
    with open(binary, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def resolve_profile(binary: Path = WECHAT_BIN) -> Profile:
    fp = fingerprint(binary)
    if fp not in OFFSETS:
        raise NotImplementedError(
            f"no profile for binary fingerprint {fp[:16]}…\n"
            "This build hasn't been reverse-engineered yet. Discover the key-write "
            "offset / memscan pattern on Mac, then add a Profile to OFFSETS."
        )
    return OFFSETS[fp]


def extract_key(binary: Path = WECHAT_BIN) -> str:
    """Return the 32-byte key as 64-hex. macOS only; not implemented yet."""
    profile = resolve_profile(binary)  # raises until OFFSETS is populated
    raise NotImplementedError(
        f"LLDB extraction ({profile.route}) for build {profile.build} is TODO. "
        "Implement on Mac: attach lldb to WeChat at login, capture the key, "
        "then hand it to keystore.set_key()."
    )
