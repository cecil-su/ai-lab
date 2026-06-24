"""Open WeChat SQLCipher DBs and run queries.

Shells out to the `sqlcipher` CLI (same approach as upstream) so we don't need a
native Python sqlcipher build. PRAGMAs match WeChat's cipher profile and are
the stable, version-independent part of the whole project.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

# WeChat's SQLCipher profile. Public + stable across the 4.x line.
PRAGMAS = (
    "PRAGMA cipher_compatibility = 4;",
    "PRAGMA kdf_iter = 256000;",
    "PRAGMA cipher_page_size = 4096;",
    "PRAGMA cipher_hmac_algorithm = HMAC_SHA512;",
    "PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA512;",
)


class SqlcipherError(RuntimeError):
    pass


def have_sqlcipher() -> bool:
    return shutil.which("sqlcipher") is not None


def query(db_path: str | Path, key_hex: str, sql: str) -> list[dict]:
    """Run one SQL statement against an encrypted DB, return rows as dicts."""
    if not have_sqlcipher():
        raise SqlcipherError("`sqlcipher` CLI not found on PATH (e.g. `brew install sqlcipher`).")
    stmt = sql if sql.rstrip().endswith(";") else sql + ";"
    script = "\n".join(
        [f"PRAGMA key = \"x'{key_hex}'\";", *PRAGMAS, ".mode json", stmt]
    )
    proc = subprocess.run(
        ["sqlcipher", str(db_path)],
        input=script,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise SqlcipherError(proc.stderr.strip() or "sqlcipher exited non-zero")
    out = proc.stdout.strip()
    if not out:
        return []
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        # Wrong key → garbled/empty; or the statement returned no JSON.
        raise SqlcipherError(f"could not parse sqlcipher output ({e}). First 300 chars:\n{out[:300]}")


def list_tables(db_path: str | Path, key_hex: str) -> list[str]:
    rows = query(
        db_path, key_hex,
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    return [r["name"] for r in rows]


def table_columns(db_path: str | Path, key_hex: str, table: str) -> list[dict]:
    if not table.replace("_", "").isalnum():
        raise ValueError(f"refusing suspicious table name: {table!r}")
    return query(db_path, key_hex, f"PRAGMA table_info({table})")
