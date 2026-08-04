# Implementation Handoff

## Delivered

- Added local Pi package `packages/pi-web-search` and workspace registration.
- Registered exactly one Pi tool, `web_search`, through `package.json#pi.extensions`.
- Implemented Brave-first automatic routing with fixed Startpage/DuckDuckGo/Mojeek public fallback.
- Implemented source-only output, central query parsing/filtering, original-language preservation, literal `lang:` tokens, deterministic consensus ranking, one vote per engine, and non-default-port-safe URL canonicalization.
- Implemented 30-second whole-tool budget, provider/request deadlines, hard aggregate cap, caller-abort preservation, straggler cancellation, response-reader cancellation, and 2 MiB body limit.
- Implemented bounded, JSON-safe details and entry-atomic 24 KiB text / 32 KiB details truncation.
- Added secret redaction for provider diagnostics, ordinary Brave `web.results`-only parsing, public-engine challenge detection, docs, and full oh-my-pi MIT notice.
- Graduated and removed the old runnable `lab/websearch-proto`; the root lockfile replaces its stale importer with `packages/pi-web-search`.
- Preserved all existing app/tool lockfile importer resolutions while adding only the new package's required dependency entries.

## Changed paths

- `packages/pi-web-search/**` (new package, source, fixtures, 40 offline tests, live smoke)
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `.trellis/tasks/08-01-pi-web-search/**` planning/research artifacts
- `lab/websearch-proto/**` removed by graduation (the directory was untracked before this task; the stale lock importer was tracked)

## Validation

Passed:

- `pnpm install --offline --frozen-lockfile --filter @ai-lab/pi-web-search`
- `pnpm --filter @ai-lab/pi-web-search typecheck`
- `pnpm --filter @ai-lab/pi-web-search test` — 7 files, 40 tests
- `pnpm --filter @ai-lab/pi-web-search check`
- `PI_WEB_SEARCH_LIVE=1 PI_WEB_SEARCH_MODE=public pnpm --filter @ai-lab/pi-web-search test:live` — public network smoke passed in about 5 seconds
- `npm pack --dry-run ./packages/pi-web-search` — 17 intended runtime/docs files
- isolated Pi 0.83 package-root load: `pi -ne -e <absolute-package-root> --list-models`
- Trellis context validation
- final focused reviewer recheck — PASS, no blocker/high finding
- no staged files

## Not run

- Live Brave request: no deliberate use or disclosure of a real `BRAVE_API_KEY`.
- Interactive TUI Esc keypress: cancellation is covered offline at HTTP reader, aggregate, and top-level orchestration layers, including signal-ignoring fakes.
- Persistent `pi install`: intentionally avoided because it would modify user settings; package-root temporary loading passed.

## Residual risks

- Public search HTML and anti-bot behavior remain externally volatile.
- Brave availability depends on the user's account, quota, network, and current API terms.
- The lockfile necessarily adds the transitive graph for exact Pi 0.83 development compatibility, but existing workspace importer resolutions remain unchanged.
