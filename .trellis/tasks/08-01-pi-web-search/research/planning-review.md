# Implementation Plan

## Goal

Deliver a local, independently installable `packages/pi-web-search` Pi 0.83 extension that registers one sources-only `web_search` tool with Brave-first fallback, bounded JSON-safe results, and correct cancellation/deadline semantics.

## Review Findings

- **Blocker:** `.trellis/tasks/08-01-pi-web-search/` lacks the required `design.md` and `implement.md` for this complex task; both context manifests still contain only seed rows. The task should not move from planning until these are completed.
- **Blocker:** `lab/websearch-proto/src/public.ts:101-124` catches caller aborts as engine failures and can continue fallback. Pre-aborted and mid-flight cancellation must propagate the caller signal’s original reason unchanged.
- **High:** `pnpm-workspace.yaml:1-4` excludes `packages/*`, and `packages/` does not yet exist.
- **High:** `lab/websearch-proto/src/fetch.ts:48-60` buffers complete response bodies with `response.text()`. A timeout alone does not prevent excessive decompressed-body memory use.
- **High:** `lab/websearch-proto/src/public.ts:83-87` exposes consensus as a `Map`, which loses information through normal JSON serialization.
- **High:** `lab/websearch-proto/src/cli.ts:51-61` parses directives, but `lab/websearch-proto/src/public.ts` never applies the existing central lenient constraint filter.
- **High:** Locale behavior conflicts with the approved automatic/global policy:
  - `lab/websearch-proto/src/engines/duckduckgo.ts:91-94` forces `kl=us-en`.
  - `lab/websearch-proto/src/engines/mojeek.ts:14,98-104` uses the German endpoint and forces English.
  - `lab/websearch-proto/src/fetch.ts:20-38` sends `Accept-Language: en-US,en`.
- **High:** The previously proposed timeout policy lacks one whole-tool budget. Sequential Brave timeout followed by a full public timeout could otherwise produce unexpectedly long calls.
- **High:** `lab/websearch-proto/src/query.ts:187-208,395-400` recognizes `lang:`/`language:` but formatting and post-filtering do not enforce them, so they can be silently removed. Under the approved automatic-language decision, treat these as ordinary literal query text rather than supported locale controls.
- **High:** `lab/websearch-proto/src/public.ts:59-81` can count duplicate URL variants from one engine as multiple consensus votes.
- **High:** `vendor/oh-my-pi/LICENSE:1-21` requires retention of the complete MIT notice for copied or substantially adapted parser, merge, provider, or formatter code.
- **Medium:** Environment-configurable engine registries, timeout variables, provider classes, and a general provider ecosystem would exceed the approved MVP. Only `BRAVE_API_KEY` and an operator-only `PI_WEB_SEARCH_MODE=auto|public` are needed.
- **Evidence:** Pi 0.83 supports package-local TypeScript extensions and local-path installs (`C:/Users/shuxingxing/scoop/apps/pi-coding-agent/0.83.0/docs/packages.md:23-49,107-125`), requires bundled Pi packages as `"*"` peers (`docs/packages.md:155-171`), supplies the tool abort signal (`docs/extensions.md:1925-1943`), requires throwing for `isError: true` (`docs/extensions.md:1957-1969`), and recommends `StringEnum` for Google-compatible schemas (`docs/extensions.md:1973`).

## Tasks

1. **Complete the Trellis planning gate**
   - Files:
     - `.trellis/tasks/08-01-pi-web-search/design.md`
     - `.trellis/tasks/08-01-pi-web-search/implement.md`
     - `.trellis/tasks/08-01-pi-web-search/implement.jsonl`
     - `.trellis/tasks/08-01-pi-web-search/check.jsonl`
   - Changes:
     - Convert this review into the authoritative design and ordered execution checklist.
     - Replace seed-only JSONL rows with the PRD research artifacts and this planning review.
     - Record the fixed MVP exclusions and the contracts below before starting the task.
   - Acceptance:
     - Both planning documents exist.
     - Both manifests contain real context entries.
     - `task.py validate` passes before `task.py start`.

2. **Add the workspace package shell**
   - Files:
     - `pnpm-workspace.yaml`
     - `pnpm-lock.yaml`
     - `packages/pi-web-search/package.json`
     - `packages/pi-web-search/tsconfig.json`
   - Changes:
     - Add `"packages/*"` to the workspace.
     - Create private ESM package `@local/pi-web-search`.
     - Declare `"pi": { "extensions": ["./extensions/index.ts"] }` and keyword `pi-package`.
     - Add `"*"` peer dependencies for `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `typebox`.
     - Use exact Pi 0.83 development versions for local compatibility checks; add TypeScript, Node types, and Vitest.
     - Extend `../../tsconfig.base.json`, use `noEmit`, DOM types, and `allowImportingTsExtensions`.
     - Add `typecheck`, `test`, and opt-in `test:live` scripts.
   - Acceptance:
     - pnpm recognizes `@local/pi-web-search`.
     - Installation produces one new lockfile importer without unrelated upgrades.

3. **Define the minimal core and exact stable contracts**
   - Files:
     - `packages/pi-web-search/src/contracts.ts`
     - `packages/pi-web-search/src/config.ts`
   - Changes:
     - Define a functional `SearchProvider` seam rather than provider base classes or a registry.
     - Fix the model-facing request contract:
       - `query: string`, trimmed, 1–2,000 characters.
       - `limit?: integer`, 1–20, default 10 in code.
       - `recency?: "day" | "week" | "month" | "year"`.
     - Read only:
       - `BRAVE_API_KEY`
       - `PI_WEB_SEARCH_MODE=auto|public`, default `auto`
     - Invalid mode must fail when the tool executes, not prevent Pi from loading the extension.
     - Define the returned details shape exactly:

```ts
interface WebSearchDetails {
  schemaVersion: 1;
  mode: "auto" | "public";
  provider: "brave" | "public";
  sources: Array<{
    index: number;
    title: string;
    url: string;
    snippet?: string;
    publishedDate?: string;
    engines: Array<"brave" | "duckduckgo" | "mojeek" | "startpage">;
    engineCount: number;
  }>;
  attempts: Array<{
    provider: "brave" | "public";
    outcome: "success" | "empty" | "error" | "timeout";
    durationMs: number;
    error?: string;
  }>;
  engineAttempts: Array<{
    engine: "duckduckgo" | "mojeek" | "startpage";
    outcome: "success" | "empty" | "error" | "timeout";
    resultCount: number;
    durationMs: number;
    error?: string;
  }>;
  relaxedConstraints: string[];
  truncated: boolean;
}
```

   - Acceptance:
     - No `Map`, `Set`, `Error`, signal, response object, secret, or class instance crosses the details boundary.
     - JSON stringify/parse preserves the documented fields.
     - Missing Brave credentials are normal auto-mode configuration, not an error.

4. **Port and synchronize only the query algorithms that are required**
   - File: `packages/pi-web-search/src/query.ts`
   - Changes:
     - Adapt the parser, provider formatter, and lenient filter from `lab/websearch-proto/src/query.ts`, with provenance.
     - Parse once in the top-level orchestrator and pass the same structured query to every attempt.
     - Support quotes, negation, OR/AND syntax, `site` aliases, `inurl`, `intitle`, `intext`, `filetype`, `before`/`after` aliases, and `allin*`.
     - Centrally filter constraints provider output did not enforce. Apply `intext` against available title/snippet text and relax it visibly if no source survives.
     - Remove special `lang:`/`language:` parsing so automatic locale remains authoritative and these tokens are not silently deleted.
     - Inject `now` into relative-date filtering for deterministic tests.
   - Acceptance:
     - Unsupported directives remain literal query text.
     - Every recognized constraint is either enforced or listed in `relaxedConstraints`.
     - The original natural-language text and script are preserved.

5. **Implement bounded, abort-aware HTTP transport**
   - File: `packages/pi-web-search/src/http.ts`
   - Changes:
     - Compose caller cancellation with internal request deadlines without losing the caller’s abort reason.
     - Race the operation itself against abort/deadline promises so a mocked or broken transport that ignores its signal cannot pin the tool.
     - Remove abort listeners and clear timers in `finally`; cancel response readers and straggling requests.
     - Stream response bodies through a byte-counting reader. Reject bodies above a fixed decompressed limit, rather than calling unrestricted `response.text()`.
     - Suggested internal bounds:
       - Search response body: 2 MiB.
       - Error body inspected internally: 16 KiB.
       - Returned error text: 240 characters, sanitized and never copied verbatim from arbitrary response bodies.
     - Use neutral browser-like headers without `Accept-Language`; never place the Brave key in URLs or diagnostics.
   - Acceptance:
     - Pre-abort and mid-flight abort reject promptly with `signal.reason`.
     - Internal timeouts have a distinct classification.
     - Oversized bodies stop reading and produce a bounded provider failure.

6. **Implement the Brave provider**
   - File: `packages/pi-web-search/src/providers/brave.ts`
   - Changes:
     - Adapt only the REST mapping from `vendor/oh-my-pi/packages/coding-agent/src/web/search/providers/brave.ts`.
     - Use `https://api.search.brave.com/res/v1/web/search`, `X-Subscription-Token`, bounded `count`, `extra_snippets=true`, and mapped freshness.
     - Do not send `country`, `search_lang`, or another forced locale.
     - Let explicit `before:`/`after:` bounds override the recency freshness value.
     - Validate `http:`/`https:` result URLs and bound returned fields before retaining them.
     - Convert HTTP/auth/quota/body errors to safe provider errors without response-body or key leakage.
   - Acceptance:
     - With a key and non-empty Brave sources, auto mode performs no public fetch.
     - Request fixture tests verify the exact URL parameters and header placement.
     - Brave ordering remains API ordering.

7. **Harden the three public engine adapters**
   - Files:
     - `packages/pi-web-search/src/providers/duckduckgo.ts`
     - `packages/pi-web-search/src/providers/mojeek.ts`
     - `packages/pi-web-search/src/providers/startpage.ts`
   - Changes:
     - Rebuild adapters around `src/http.ts`; do not copy the prototype transport.
     - Retain only validated parsing, query mapping, challenge detection, recency mapping, deduplication, and result bounds.
     - Remove DuckDuckGo `kl=us-en`.
     - Use Mojeek’s global `.com` endpoint and omit `lang`/`lb`; verify this endpoint in the opt-in live smoke test.
     - Leave Startpage region/language parameters unset.
     - Keep no headless escalation or CAPTCHA solving.
   - Acceptance:
     - Request tests assert no fixed language or country parameters and no `Accept-Language`.
     - Fixture tests cover success, empty page, malformed entries, HTTP errors, and challenge pages.
     - Each adapter deduplicates canonical URLs within its own response.

8. **Implement public aggregation and Brave-first orchestration**
   - Files:
     - `packages/pi-web-search/src/providers/public.ts`
     - `packages/pi-web-search/src/search.ts`
   - Changes:
     - Keep a fixed three-engine tuple; no registry, plugin provider ecosystem, or model-facing provider selector.
     - Merge in fixed engine-priority order, not settlement order.
     - Canonicalize host, trailing slash, and fragment consistently while retaining query strings.
     - Track `Set<engineId>` internally, then emit sorted JSON arrays and `engineCount`.
     - Apply exact timing defaults:
       - Whole tool: 30 seconds.
       - Brave attempt: 10 seconds.
       - Public soft deadline: 5 seconds.
       - Public hard deadline: 20 seconds, capped by remaining whole-tool time.
       - Individual public request: 15 seconds, capped by remaining aggregate/tool time.
     - Keep timing values injectable only through core options for tests; do not expose timeout environment variables.
     - Public soft deadline returns only when a non-empty result exists. Otherwise wait for a non-empty result, all engines settling, caller abort, or hard deadline.
     - Abort all public stragglers after a return decision.
     - Enforce this fallback policy:
       1. `public` mode always runs only the public aggregate.
       2. Auto without a Brave key runs public only.
       3. Auto with a key runs Brave first.
       4. Non-empty Brave results return immediately.
       5. Brave error, internal timeout, or empty result triggers public fallback.
       6. Caller abort never triggers fallback.
       7. Any provider/engine sources constitute success despite other failures.
       8. If at least one attempt completed normally with zero results and no source exists, return a normal empty result.
       9. Throw a bounded unavailable error only when every attempted path failed operationally or timed out.
   - Acceptance:
     - Stable ties and one-vote-per-engine consensus are deterministic.
     - Partial failures preserve sources and diagnostics.
     - All-operational-failure throws so Pi marks `isError: true`.
     - Empty search remains a successful `No results found` result.

9. **Bound and format source-only output**
   - File: `packages/pi-web-search/src/format.ts`
   - Changes:
     - Format stable citation entries as `[n] title`, direct URL, optional snippet/date, and public engine attribution.
     - Prefix results as untrusted web sources, not instructions or a synthesized answer.
     - Bound individual fields, normalize controls/whitespace, and discard invalid or excessively long URLs instead of truncating them into invalid links.
     - Suggested field limits: title 200 characters, snippet 240, date 80, URL 2,048, diagnostic string 240.
     - Build complete entries until both the 24-KiB text cap and 32-KiB serialized-details cap are satisfied. Drop trailing entries as a unit and set `truncated: true`.
     - Ensure the text numbering and `details.sources` always describe the same retained list.
   - Acceptance:
     - Maximum-shaped output remains within both caps.
     - No partial citation entry or mismatched index is returned.
     - The formatter never creates a temp file.

10. **Register the Pi extension**
    - File: `packages/pi-web-search/extensions/index.ts`
    - Changes:
      - Export a default Pi extension factory and a testable `registerWebSearchTool(pi, dependencies?)` helper.
      - Register exactly one tool:
        - `name: "web_search"`
        - `label: "Web Search"`
        - strict `Type.Object` parameters with `additionalProperties: false`
        - `StringEnum` for recency
      - Use a concise `promptSnippet`: “Search the web for current information and return ranked, untrusted sources with URLs.”
      - Do not add commands, renderers, settings UI, TUI state, or additional tools.
      - Forward the exact `execute` signal into the core.
      - Do not catch caller cancellation. Catch only safe operational errors when additional sanitization is necessary, then throw to produce Pi `isError: true`.
   - Acceptance:
     - A fake `ExtensionAPI` observes one `registerTool` call named `web_search`.
     - The captured execute function forwards signal identity exactly.
     - The extension contains no import from `vendor/oh-my-pi` or `lab/websearch-proto`.

11. **Add the offline regression suite**
    - Files:
      - `packages/pi-web-search/test/query.test.ts`
      - `packages/pi-web-search/test/http.test.ts`
      - `packages/pi-web-search/test/brave.test.ts`
      - `packages/pi-web-search/test/public-providers.test.ts`
      - `packages/pi-web-search/test/public-aggregate.test.ts`
      - `packages/pi-web-search/test/search.test.ts`
      - `packages/pi-web-search/test/format.test.ts`
      - `packages/pi-web-search/test/extension.test.ts`
      - `packages/pi-web-search/test/live.test.ts`
      - `packages/pi-web-search/test/fixtures/*.html`
   - Changes:
     - Port only applicable upstream/prototype regression cases.
     - Cover parser aliases, literal locale tokens, provider formatting, each lenient constraint, and relaxation notes.
     - Cover canonical URL variants, query/fragment handling, same-engine duplicates, longest snippet, consensus, deterministic ties, and result limits.
     - Cover partial/all failure, empty results, soft/hard deadlines, whole-tool budget, straggler abort, and fallback ordering.
     - Cover pre-aborted and mid-flight signals plus mocked fetch that ignores abort; assert the original reason escapes and public fallback does not begin.
     - Cover response-body limits and timer/listener cleanup.
     - Cover exact schema registration, signal forwarding, JSON round-trip, bounds, stable citation indexes, and no secret leakage.
     - Keep `live.test.ts` excluded from normal `test`; skip Brave cases when no key is available.
   - Acceptance:
     - All normal tests are fixture-only and perform no network access.
     - Fake timers make deadline tests fast and deterministic.
     - Normal test execution passes without credentials.

12. **Add attribution and operator documentation**
    - Files:
      - `packages/pi-web-search/README.md`
      - `packages/pi-web-search/THIRD_PARTY_NOTICES.md`
   - Changes:
     - Include the full upstream MIT notice from `vendor/oh-my-pi/LICENSE`.
     - Identify each adapted file/algorithm and pin provenance to upstream commit `a7abeff1b7c0c94f9b63b11bd8b40d881f26a72f`.
     - Add provenance headers to substantially adapted source files.
     - Document local install, temporary loading, Brave key setup, forced public mode, automatic locale behavior, arguments, output contract, privacy fan-out, quota, scraping volatility, untrusted-content risk, and lack of headless CAPTCHA handling.
     - State that the extension returns sources only and that Pi’s active model performs synthesis.
   - Acceptance:
     - The complete upstream notice is present in package contents.
     - Documentation contains no claim that keyless public scraping is reliable.
     - No example exposes or echoes a real key.

13. **Run package, install, and manual behavior validation**
   - Files: all package and workspace files above.
   - Changes: none beyond fixes needed for validation.
   - Acceptance commands:

```powershell
pnpm install
pnpm --filter @local/pi-web-search typecheck
pnpm --filter @local/pi-web-search test
npm pack --dry-run .\packages\pi-web-search
```

   - Temporary Pi load:

```powershell
$pkg = (Resolve-Path .\packages\pi-web-search).Path
pi -e $pkg --no-builtin-tools --tools web_search
```

   - Persistent local install smoke, followed by cleanup:

```powershell
pi install $pkg
pi list
pi remove $pkg
```

   - Manual Brave success:
     - Set a valid `BRAVE_API_KEY`.
     - Run Pi with only `web_search`.
     - Request a current query and verify Brave attribution, bounded indexed URLs, and no public fan-out.
   - Manual failure:
     - Set `PI_WEB_SEARCH_MODE=invalid`.
     - Invoke the tool and verify a clear thrown configuration error is marked as a tool failure.
   - Manual cancellation:
     - Force public mode, invoke a search, press Esc immediately, and verify prompt control returns promptly with no fallback result appearing later.
   - Optional live core smoke:

```powershell
pnpm --filter @local/pi-web-search test:live
```

## Files to Modify

- `.trellis/tasks/08-01-pi-web-search/implement.jsonl` - replace seed context with research references.
- `.trellis/tasks/08-01-pi-web-search/check.jsonl` - replace seed context with review references.
- `pnpm-workspace.yaml` - include `packages/*`.
- `pnpm-lock.yaml` - add the package importer and its development dependencies.

## New Files

- `.trellis/tasks/08-01-pi-web-search/design.md` - authoritative architecture and contracts.
- `.trellis/tasks/08-01-pi-web-search/implement.md` - ordered implementation and validation checklist.
- `packages/pi-web-search/package.json` - Pi package metadata and scripts.
- `packages/pi-web-search/tsconfig.json` - raw-TypeScript typecheck configuration.
- `packages/pi-web-search/extensions/index.ts` - thin Pi tool registration adapter.
- `packages/pi-web-search/src/contracts.ts` - provider-neutral and JSON details contracts.
- `packages/pi-web-search/src/config.ts` - minimal environment configuration.
- `packages/pi-web-search/src/query.ts` - attributed query parser/formatter/filter.
- `packages/pi-web-search/src/http.ts` - bounded abort/deadline-aware transport.
- `packages/pi-web-search/src/search.ts` - Brave-first orchestration and central filtering.
- `packages/pi-web-search/src/format.ts` - bounded source and details formatting.
- `packages/pi-web-search/src/providers/brave.ts` - Brave REST adapter.
- `packages/pi-web-search/src/providers/public.ts` - public aggregation and consensus.
- `packages/pi-web-search/src/providers/duckduckgo.ts` - keyless DDG adapter.
- `packages/pi-web-search/src/providers/mojeek.ts` - keyless global Mojeek adapter.
- `packages/pi-web-search/src/providers/startpage.ts` - keyless Startpage adapter.
- `packages/pi-web-search/test/*.test.ts` - offline core and extension tests.
- `packages/pi-web-search/test/fixtures/*.html` - provider HTML fixtures.
- `packages/pi-web-search/README.md` - installation, configuration, caveats, and smoke checks.
- `packages/pi-web-search/THIRD_PARTY_NOTICES.md` - upstream MIT notice and provenance.

## Dependencies

- Task 1 must complete before task activation or source implementation.
- Task 2 is required before package-scoped pnpm validation.
- Tasks 3–5 establish contracts and transport used by Tasks 6–10.
- Tasks 6 and 7 must complete before Task 8 orchestration.
- Task 8 must complete before final formatting and Pi execution tests.
- Task 9 defines the details returned by Task 10.
- Task 11 depends on the corresponding implementation slices and should be developed incrementally with them.
- Documentation and attribution must be complete before packaging/install smoke checks.
- Full validation in Task 13 depends on every preceding task.

## Risks

- Public HTML and anti-bot behavior can change independently of this package; fixtures cannot guarantee live availability.
- Mojeek’s `.com` automatic/global behavior requires live verification because the prototype and upstream currently force `.de` plus English parameters.
- Brave usage introduces credential, quota, privacy, and possibly display-attribution obligations; current Brave API terms should be checked before claiming compliance.
- A fetch implementation that ignores abort may leave an unreachable promise alive after the core returns. The design bounds user-visible latency and aborts transport, but cannot forcibly terminate arbitrary third-party JavaScript.
- Search snippets remain untrusted prompt-injection content. Labeling and documentation reduce confusion but do not make them safe instructions.
- Raw TypeScript loading must be smoke-tested against Pi 0.83’s jiti resolver; typecheck alone does not prove local package loading.
- `lang:` handling is intentionally changed from the prototype because the prototype parses and then silently discards it. If explicit inline language overrides are later desired, they require a separate product decision and provider mapping.
- Do not add engine allowlists, timeout environment variables, caching, a CLI, a settings UI, custom rendering, result-page fetching, browser automation, nested LLM calls, or additional providers during MVP implementation.