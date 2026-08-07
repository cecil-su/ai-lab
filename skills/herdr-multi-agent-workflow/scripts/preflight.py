#!/usr/bin/env python3
"""Report Herdr workflow prerequisites without exposing secret values."""

from __future__ import annotations

import json
import os
import platform
import shutil
from pathlib import Path


COMMANDS = ("git", "herdr", "pi", "claude", "codex")
NON_SECRET_ENV = (
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
)
SECRET_ENV = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY")


def main() -> None:
    commands = {name: shutil.which(name) for name in COMMANDS}
    environment = {name: os.environ.get(name) for name in NON_SECRET_ENV}
    secrets = {name: bool(os.environ.get(name)) for name in SECRET_ENV}

    report = {
        "platform": platform.platform(),
        "cwd": str(Path.cwd()),
        "commands": commands,
        "environment": environment,
        "secrets_present": secrets,
        "ready_for_manual_mode": bool(commands["git"] and commands["herdr"] and commands["pi"]),
        "notes": [
            "Secret values are never printed.",
            "Official Herdr integrations and Pi delegation extensions are separate components.",
        ],
    }
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
