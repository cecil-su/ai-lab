"""wechat-use CLI (Phase 0-1 scaffold)."""
from __future__ import annotations

import argparse
import json
import sys

from . import doctor, export, keystore, messages, paths, sqlcipher


def _print(obj, as_json: bool) -> None:
    if as_json:
        print(json.dumps(obj, ensure_ascii=False, indent=2, default=str))
    else:
        print(obj)


def _require_key(args) -> str:
    key = keystore.get_key(args.account)
    if not key:
        sys.exit("no cached key. Run: wechat-use key set <64-hex>  (Phase 2 will automate this)")
    return key


def cmd_doctor(args) -> None:
    rows = doctor.run()
    if args.json:
        _print(rows, True)
        return
    for r in rows:
        mark = "OK " if r["ok"] else "XX "
        print(f"{mark} {r['check']:<20} {r['detail']}")
    if not any(r["check"] == "platform" and r["ok"] for r in rows):
        print("\nnote: not macOS — env checks are informational; sqlcipher read layer still works.")


def cmd_dbs(args) -> None:
    dbs = [str(p) for p in paths.find_message_dbs()]
    if args.json:
        _print({"container": str(paths.container_root()), "dbs": dbs}, True)
        return
    print(f"container: {paths.container_root()}")
    if not dbs:
        print("no message DBs found (expected on non-Mac, or refine globs in paths.py)")
    for d in dbs:
        print(" ", d)


def cmd_key(args) -> None:
    if args.action == "set":
        keystore.set_key(args.hex, args.account)
        print(f"key stored for account '{args.account}' at {keystore.KEY_FILE}")
    elif args.action == "get":
        k = keystore.get_key(args.account)
        print(k if k else "(none)")
    elif args.action == "path":
        print(keystore.KEY_FILE)


def cmd_tables(args) -> None:
    key = _require_key(args)
    _print(sqlcipher.list_tables(args.db, key), args.json)


def cmd_schema(args) -> None:
    key = _require_key(args)
    _print(sqlcipher.table_columns(args.db, key, args.table), args.json)


def cmd_query(args) -> None:
    key = _require_key(args)
    _print(sqlcipher.query(args.db, key, args.sql), True)


def cmd_history(args) -> None:
    key = _require_key(args)
    rows = messages.history(args.db, key, args.chat, args.n)
    _print(rows, True)


def cmd_export(args) -> None:
    key = _require_key(args)
    rows = messages.history(args.db, key, args.chat, args.n)
    if args.format == "json":
        out = export.to_json(rows)
    else:
        out = export.to_markdown(rows, title=f"{args.chat} (last {args.n})")
    if args.o:
        with open(args.o, "w", encoding="utf-8") as f:
            f.write(out)
        print(f"wrote {len(rows)} messages -> {args.o}")
    else:
        print(out)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="wechat-use", description="macOS WeChat local API (replica, Phase 0-1).")
    p.add_argument("--account", default="default", help="key account name")
    p.add_argument("--json", action="store_true", help="JSON output")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("doctor", help="Phase 0 environment checks").set_defaults(func=cmd_doctor)
    sub.add_parser("dbs", help="discover WeChat message DB files").set_defaults(func=cmd_dbs)

    kp = sub.add_parser("key", help="manage the cached SQLCipher key")
    kp.add_argument("action", choices=["set", "get", "path"])
    kp.add_argument("hex", nargs="?", help="64-hex key (for `set`)")
    kp.set_defaults(func=cmd_key)

    tp = sub.add_parser("tables", help="list tables in a DB (needs key)")
    tp.add_argument("--db", required=True)
    tp.set_defaults(func=cmd_tables)

    scp = sub.add_parser("schema", help="list columns of a table (needs key)")
    scp.add_argument("--db", required=True)
    scp.add_argument("table")
    scp.set_defaults(func=cmd_schema)

    qp = sub.add_parser("query", help="run raw SQL, return JSON (needs key)")
    qp.add_argument("--db", required=True)
    qp.add_argument("sql")
    qp.set_defaults(func=cmd_query)

    hp = sub.add_parser("history", help="recent messages for a chat wxid (UNVERIFIED schema)")
    hp.add_argument("--db", required=True)
    hp.add_argument("chat", help="chat wxid (DM wxid or <id>@chatroom)")
    hp.add_argument("-n", type=int, default=50)
    hp.set_defaults(func=cmd_history)

    ep = sub.add_parser("export", help="export a chat to markdown/json")
    ep.add_argument("--db", required=True)
    ep.add_argument("chat")
    ep.add_argument("-n", type=int, default=200)
    ep.add_argument("--format", choices=["markdown", "json"], default="markdown")
    ep.add_argument("-o", help="output file (default: stdout)")
    ep.set_defaults(func=cmd_export)

    return p


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    try:
        args.func(args)
    except (sqlcipher.SqlcipherError, NotImplementedError, ValueError) as e:
        sys.exit(f"error: {e}")


if __name__ == "__main__":
    main()
