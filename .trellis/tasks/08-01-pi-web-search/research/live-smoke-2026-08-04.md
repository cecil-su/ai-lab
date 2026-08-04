# Live Smoke — pi-web-search (2026-08-04)

Non-gating manual smoke per implement.md §10. Recorded for provenance; live network
behavior is best-effort and not a CI gate.

## Environment

- Pi CLI `0.83.0` (matches pinned compat version), Node `v24.11.1`, pnpm `10.33.0`.
- `BRAVE_API_KEY` **not set** → exercises the no-key → public-aggregate path.
- Load: `pi -p --mode json -ne -nbt -nc --thinking off -e "D:/Workspace/ai/ai-lab/packages/pi-web-search" --model 'openai-codex/gpt-5.4-mini' "<call web_search once, query 'anthropic claude', limit 3>"`

## Results

- **Extension load**: OK. Raw-TS extension loaded via `package.json#pi.extensions` under Pi 0.83 — no import/schema/registration errors.
- **Tool registration + invocation**: `web_search` registered and called exactly once with `{query:"anthropic claude", limit:3}`.
- **No-key fallback**: `mode:auto`, `provider:public` — correctly skipped Brave (no key) and used the public aggregate.
- **Real sources returned** (3): anthropic.com claude-3-family / claude-3-7-sonnet / claude-3-5-sonnet, each with bounded title/url/snippet, `engines:["mojeek"]`, `engineCount:1`.
- **Partial-failure tolerance (live)**: `engineAttempts` = startpage `timeout` (5019ms, "Stopped after the public aggregate deadline"), duckduckgo `error` ("DuckDuckGo blocked the request with a bot challenge"), mojeek `success` (3 results, 1457ms). Surviving Mojeek results returned despite two engine failures.
- **Consensus**: each source `engineCount:1` from Mojeek only — no double-counting.
- **Bounds / JSON-safety**: `schemaVersion:1`, `truncated:false`, `relaxedConstraints:[]`, `elapsedMs:5022`; entire details object is plain-JSON serializable (arrived intact over the JSON stream).
- **No secret leakage / no unhandled errors** in output.

Numbers match the PRD's 2026-08-01 finding (Mojeek ~1.5s, DDG bot-challenged, Startpage failed, aggregate ~5s).

## Not manually exercised (covered by offline tests)

- **Brave-first path**: requires `BRAVE_API_KEY`; covered by `test/providers.test.ts` + `test/search.test.ts` fixtures.
- **Esc / caller cancellation**: interactive; not driven in `-p` mode. Covered by pre-abort / mid-flight / abort-ignoring-transport tests in `test/http.test.ts`, `test/search.test.ts`, `test/public.test.ts`.
