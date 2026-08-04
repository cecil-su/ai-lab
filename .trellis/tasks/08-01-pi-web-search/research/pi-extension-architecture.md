# Pi 0.83 Web Search Extension Architecture Assessment

## Review

- **Correct:** The prototype already isolates useful domain types, query parsing, injectable `fetch`, per-engine adapters, and deterministic consensus ranking. The pure pieces worth retaining are `SearchSource`/`SearchProviderError` (`lab/websearch-proto/src/types.ts:10-49`), query parsing/filtering (`lab/websearch-proto/src/query.ts:519-692`), and the canonical URL/merge algorithm (`lab/websearch-proto/src/public.ts:39-81`).
- **Correct:** The partial-failure strategy is appropriate for brittle public engines: the aggregate runs engines concurrently and preserves responses from surviving engines (`lab/websearch-proto/src/public.ts:101-131`). The live smoke run in this review returned three Mojeek results in about 5.1 seconds even though DuckDuckGo was bot-blocked and Startpage failed.
- **Correct:** Pi 0.83 directly supports the intended distribution model. A package declares TypeScript extension entry points under `package.json#pi.extensions` (`C:/Users/shuxingxing/scoop/apps/pi-coding-agent/0.83.0/docs/packages.md:118-125`), local directories can be installed without copying (`docs/packages.md:107-114`), and extension tools receive `signal` and return `{content, details}` (`docs/extensions.md:1925-1943`). No subprocess wrapper around `src/cli.ts` is needed.

- **Blocker — cancellation is currently converted into provider failure:** `searchPublicWeb()` catches every engine error, including caller cancellation, and its deadline sleeps are not passed the caller signal (`lab/websearch-proto/src/public.ts:101-124`). A pre-aborted live probe returned `SearchProviderError: All public engines failed: ... aborted` rather than propagating cancellation. Upstream explicitly rethrows caller abort after a provider catch (`vendor/oh-my-pi/packages/coding-agent/src/web/search/index.ts:232-239`) and has a regression test for this (`vendor/oh-my-pi/packages/coding-agent/test/web/search/abort-and-timeout.test.ts:191-210`). The extension must preserve Esc cancellation and must not continue fallback after it.
- **Blocker for a “production-reliable” label — keyless-only availability is insufficient:** The prototype itself records that only Mojeek worked while DuckDuckGo and Startpage were blocked/timed out, and recommends a keyed backbone or browser fallback (`lab/websearch-proto/README.md:49-64`). This review reproduced the same pattern. The smallest reliable design is an optional keyed provider (recommend Brave) ahead of the public aggregate; if no key is configured, document the tool as best-effort rather than production-reliable. Restoring Puppeteer is materially heavier and should not be the default.

- **High — the prototype is not a Pi package:** Its manifest is private lab/CLI metadata with only a `search` script and no `pi` manifest or test script (`lab/websearch-proto/package.json:2-11`); the only integration surface prints to stdout (`lab/websearch-proto/src/cli.ts:57-93`). Build a new package shell rather than evolving the CLI entry point.
- **High — directive post-filtering is implemented but not wired:** The CLI parses once (`lab/websearch-proto/src/cli.ts:51-54`), but `searchPublicWeb()` imports only `clampNumResults` and never calls `applyQueryConstraints`. Thus directives unsupported by an engine—especially Mojeek’s narrower syntax—are not enforced or reported. Upstream applies the lenient post-filter centrally and reports relaxed constraints (`vendor/oh-my-pi/packages/coding-agent/src/web/search/index.ts:205-226`; tests at `vendor/oh-my-pi/packages/coding-agent/test/web/search/query-pipeline.test.ts:36-75`).
- **High — structured details are not persistence-safe:** `PublicWebResult.consensus` is a `Map<string, number>` (`lab/websearch-proto/src/public.ts:83-87`). A Map does not survive ordinary JSON serialization as useful data, while Pi persists tool results and its UI/session logic depends on the exact details shape (`docs/extensions.md:2041-2043`). Put `engineCount` and optionally `engines: string[]` directly on each returned source, and keep all details plain JSON.
- **High — no regression suite exists:** The prototype has no test script (`lab/websearch-proto/package.json:7-9`) despite copying a large parser, regex HTML adapters, ranking, deadlines, and cancellation logic. Upstream’s aggregate suite covers consensus, partial failures, soft/hard deadlines, and all-failed behavior (`vendor/oh-my-pi/packages/coding-agent/test/tools/web-search-public.test.ts:68-198`); its timeout suite separately covers timeout composition and cancellation (`vendor/.../test/web/search/abort-and-timeout.test.ts:40-60,191-230`). These are the minimum behavioral fixtures to port.
- **High — output and input bodies need explicit bounds:** The CLI truncates snippets only for display (`lab/websearch-proto/src/cli.ts:69-74`), while the core sources/details retain unbounded titles, URLs, snippets, and fetched HTML; `browserFetch()` calls `response.text()` without a body ceiling (`lab/websearch-proto/src/fetch.ts:48-60`). Pi’s own custom-tool example says outputs must be bounded and demonstrates `truncateHead` with 2,000-line/50-KB defaults (`examples/extensions/truncated-tool.ts:4-5,91-96`). Bound fields before storing details, cap response bodies, and apply a final text-output cap.
- **High — attribution is incomplete:** The prototype says it is ported from oh-my-pi but has no package license/notice. The upstream MIT license requires the copyright and permission notice in copies or substantial portions (`vendor/oh-my-pi/LICENSE:3-4,13-14`). Preserve provenance in the promoted package.

- **Note — timer cleanup:** `withHardTimeout()` creates a timer but exposes no cleanup path (`lab/websearch-proto/src/fetch.ts:74-78`), so completed requests retain timers until they fire. Return a disposable timeout scope or wrap each request in a helper that clears its timer in `finally`.
- **Note — false consensus is possible inside one engine:** `mergeSources()` increments the engine count for every canonical duplicate but does not know the engine identity (`lab/websearch-proto/src/public.ts:59-81`). Two URL variants from one engine can therefore count as two engine votes. Deduplicate canonical keys within each engine response or retain a `Set<engineId>` per merged source.
- **Note — empty responses are treated as successes:** Every fulfilled adapter resolves `firstSuccess`, even with zero sources (`lab/websearch-proto/src/public.ts:109-113`). Only non-empty/renderable responses should satisfy the “first success” deadline condition; an honestly completed zero-result search can still be returned after all engines settle.
- **Note — regex scraper maintenance remains ongoing:** The prototype intentionally replaced DOM parsing with regex and uses static headers (`lab/websearch-proto/README.md:42-47`). Fixture tests reduce silent drift but cannot make public HTML contracts stable.

## Recommended architecture

### 1. Package shape

Create a new reusable package and leave `lab/websearch-proto` as historical evidence:

```text
packages/pi-web-search/
  package.json
  README.md
  THIRD_PARTY_NOTICES.md       # full upstream MIT notice + copied-file provenance
  extensions/
    index.ts                   # thin Pi 0.83 adapter only
  src/
    contracts.ts               # JSON-safe request/response/details types
    search.ts                  # provider selection + central constraint pipeline
    aggregate.ts               # deadlines, fan-out, consensus merge
    format.ts                  # bounded LLM-facing text
    http.ts                    # abort-aware fetch + timeout/body limits
    query.ts                   # synchronized/sourced parser
    providers/
      brave.ts                 # optional reliable keyed provider
      mojeek.ts
      duckduckgo.ts
      startpage.ts
  test/
    aggregate.test.ts
    abort.test.ts
    query.test.ts
    format.test.ts
    providers/*.test.ts
    fixtures/*.html
```

`packages/` is semantically correct for a reusable integration, but it is not currently included in the workspace (`pnpm-workspace.yaml:1-4`), so implementation must add `packages/*`. Do not import from `vendor/oh-my-pi` at runtime: `vendor/` is analysis source, carries Bun/auth/settings/browser coupling, and is gitignored.

Minimal manifest:

```json
{
  "name": "@local/pi-web-search",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "keywords": ["pi-package"],
  "pi": { "extensions": ["./extensions/index.ts"] },
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  }
}
```

Pi says bundled core packages belong in `peerDependencies` with a `"*"` range (`docs/packages.md:169-171`). Use exact `0.83.0` dev dependencies for typechecking/tests, but do not ship them as runtime dependencies. Keep raw TypeScript: Pi loads extensions through jiti (`docs/extensions.md:179-181`), so a build/distribution pipeline is unnecessary for this local package.

### 2. Thin Pi tool adapter

Register exactly one top-level tool named `web_search`, matching the established upstream name (`vendor/.../web/search/index.ts:301-306`). The adapter should only validate model input, call the neutral core with Pi’s `signal`, format bounded output, and return JSON-safe details.

Recommended model-facing schema:

- `query: string` — required, trimmed, `minLength: 1`, conservative maximum such as 2,000 characters.
- `recency?: "day" | "week" | "month" | "year"` — use `StringEnum`, because Pi documents that TypeBox literal unions are incompatible with Google providers (`docs/extensions.md:1973`).
- `limit?: integer` — clamp to `1..20`, default `10`.

Do **not** expose API keys, deadlines, engine order, or provider selection to the model. Those are operator configuration, not search intent. Also omit upstream-only `max_tokens`, `temperature`, and `num_search_results`: the extracted package returns SERP sources and performs no nested LLM synthesis.

Add a concise `promptSnippet` so the tool appears in Pi’s Available tools section (`docs/extensions.md:1857-1861`). The description should say that it returns untrusted web results, supports the implemented Google-style directives, and that final claims need linked sources. No custom renderer is required for MVP; the standard text result is sufficient.

### 3. Stable result contract

Return one text block plus plain structured details:

```ts
interface WebSearchDetails {
  response: {
    provider: "brave" | "public";
    sources: Array<{
      title: string;
      url: string;
      snippet?: string;
      publishedDate?: string;
      engineCount: number;
      engines: string[];
    }>;
  };
  engines: Array<{
    id: string;
    status: "ok" | "empty" | "error" | "timeout";
    count: number;
    durationMs: number;
    error?: string;
  }>;
  relaxedConstraints: string[];
  elapsedMs: number;
  truncated: boolean;
}
```

Text should be citation-friendly and deterministic: `[1] title`, URL on the next line, optional snippet (240 characters, following upstream’s bound at `vendor/.../web/search/index.ts:79-82`), and an optional “matched by N engines” line. Preserve ranked order. Bound title, URL, snippet, error strings, result count, total bytes, and details fields before returning; do not write a full-output temp file because search can be rerun and a temp file would add unnecessary persistence/cleanup behavior.

Treat partial engine failure as normal success when at least one source survives. Throw on invalid configuration or total operational failure so Pi marks `isError: true`; Pi 0.83 explicitly requires throwing to signal tool failure (`docs/extensions.md:1957-1969`). A genuine completed zero-result query may return `No results found` with `status: "empty"`. Never turn caller cancellation into either case.

### 4. Abort, timeout, and deadline contract

- Call `signal?.throwIfAborted()` before starting, after every caught provider error, and before returning.
- Compose every outbound request with the caller signal and a per-request deadline; clear timer/listener resources in `finally`.
- Race aggregate waiting against an explicit parent-abort promise, all-settled, the 5-second soft deadline, and the 20-second overall cap. Do not merely pass a signal to `fetch`, because a transport may ignore it.
- At the soft deadline, return only if at least one non-empty response exists; otherwise wait for first non-empty response, all engines settling, parent abort, or the hard cap.
- Abort stragglers when a return condition wins. If the hard cap wins with no completed usable response, throw a timeout/unavailable error with bounded engine diagnostics.
- Distinguish caller abort from internal timeout by checking the original caller signal first. Caller abort must escape unchanged; internal timeouts become engine stats and may be tolerated if another engine succeeds.

The defaults can remain 5-second soft, 15-second request, and 20-second overall, but make them injectable internal options for deterministic tests. They should not be model arguments.

### 5. Configuration and provider policy

Use environment configuration for the local MVP; it is simpler and safer than inventing a project JSON loader and trust hierarchy:

- `BRAVE_API_KEY` — optional reliable provider credential, never included in output/logs.
- `PI_WEB_SEARCH_MODE=auto|public` — `auto` uses Brave when configured and otherwise uses the public aggregate; `public` forces the keyless aggregate.
- `PI_WEB_SEARCH_ENGINES=mojeek,duckduckgo,startpage` — optional ordered allowlist for public mode.
- `PI_WEB_SEARCH_SOFT_TIMEOUT_MS`, `PI_WEB_SEARCH_HARD_TIMEOUT_MS` — optional, strictly parsed and bounded; invalid values fail startup or fall back with a clear warning, never become `NaN` timers.

Recommended default policy is sequential `Brave -> public aggregate`, not a 25-provider clone. This gives a reliable fast path while retaining the prototype’s credential-free consensus behavior. If credential-free operation is mandatory, default to public mode but explicitly accept lower reliability. Keep browser-backed fallback out of the base package.

The adapters currently hardcode US English (`duckduckgo.ts` and Mojeek/Startpage URL parameters), so locale/region is a user-owned decision rather than a hidden assumption.

### 6. Tests and release gate

Required offline tests:

1. Query parser/formatter/lenient constraint tests ported from upstream, including relaxed-constraint notes.
2. Consensus tests for URL variants, query/fragment behavior, longest snippet, deterministic ties, and duplicate variants from the same engine counting once.
3. Aggregate tests for partial failure, empty results, soft return, wait-for-first-nonempty, hard cap, all-failed, and straggler abort.
4. Abort tests for pre-aborted, mid-flight, and a mocked fetch that ignores abort; assert prompt cancellation returns quickly and is not wrapped.
5. Adapter HTML fixtures for successful pages, HTTP errors, bot/CAPTCHA pages, parser-empty pages, dedup, result caps, response-body cap, and recency/query mapping.
6. Formatter/details tests for 240-character snippets, total byte cap, plain JSON round-trip, no secret leakage, and stable indexed URLs.
7. Extension registration test with a fake `ExtensionAPI`: exact name/schema/prompt metadata and signal forwarding.

Keep a separate opt-in `test:live` smoke test because public HTML and network reachability are volatile; it must not gate normal CI. A release candidate is ready only after `typecheck`, offline tests, package-content inspection, local Pi registration, one successful query, one total-failure query, and an Esc-cancellation smoke test.

## MVP and non-goals

### MVP

- Local Pi package with one `web_search` extension tool.
- Provider-neutral source-only contract.
- Brave optional reliable fast path plus hardened three-engine public fallback.
- Central query parsing/post-filtering, JSON-safe details, bounded output/body sizes.
- Correct parent abort, request timeout, aggregate deadline, and partial-failure behavior.
- Offline fixtures/unit tests, Pi registration smoke test, README/install/config instructions, and MIT notice.

### Non-goals

- Copying oh-my-pi’s full provider/auth/settings stack.
- OAuth credential stores or Pi login integration.
- Headless Puppeteer/stealth/CAPTCHA solving.
- Search-answer synthesis, nested LLM calls, or token accounting.
- Fetching/reading result pages, browser automation, caching, or result history.
- Custom TUI rendering, slash commands, or standalone CLI preservation.
- Publishing to npm before the local package proves stable.

## Installation and verification

Development smoke test:

```powershell
pi -e D:\Workspace\ai\ai-lab\packages\pi-web-search\extensions\index.ts
```

Persistent reusable local install:

```powershell
pi install "D:\Workspace\ai\ai-lab\packages\pi-web-search"
pi list
```

Pi documents absolute and relative local package installs (`docs/packages.md:23-27`) and notes that global installs write user settings while `-l` writes project settings (`docs/packages.md:41-45`). Prefer the absolute path for this personal global package; use a project-local install only if the repository should declare the dependency and users will explicitly trust it.

## User-owned decisions

1. **Reliability/cost:** approve Brave (recommended) or another keyed backbone, or explicitly accept keyless-only best effort.
2. **Privacy:** decide whether each query may fan out to multiple third-party public engines; the engine allowlist should reflect that choice.
3. **Browser weight/ToS:** decide whether future headless scraping is acceptable. It is not needed for the recommended MVP.
4. **Result semantics:** confirm source-only search versus synthesized answers/citations. Source-only is the simpler, safer MVP.
5. **Locale:** choose fixed US-English behavior or add operator-configured region/language before release.
6. **Scope/location:** approve `packages/pi-web-search` plus the one-line workspace expansion, rather than treating the lab prototype as the installable package.
7. **Error semantics:** recommended Pi-native behavior is thrown total failures and normal partial/empty results; this differs from oh-my-pi’s normal `Error: ...` tool result convention (`vendor/.../web/search/index.ts:244-263`).

## Residual risks

- Public HTML, bot defenses, and engine terms can change without notice; fixtures detect parser drift only after examples are updated.
- A keyed provider improves availability but introduces credential, quota, billing, and privacy obligations.
- Search snippets are untrusted external content and can contain prompt injection. Pi does not claim to make untrusted prompts safe (`docs/security.md:33-41`); the agent must treat results as evidence, not instructions.
- Consensus is weak when only one engine answers, as demonstrated by both the prototype’s recorded measurement and this review’s live smoke run.
- The current review did not install a proposed package because it does not exist; installation/API compatibility remains a required implementation smoke test against Pi 0.83.0.
- `plan.md` requested by the task was absent at repository root; the available `progress.md` concerned unrelated work, so no task-specific design assumptions were taken from it.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Severity-ranked findings cite the prototype, oh-my-pi source/tests/license, and Pi 0.83 package/extension/security docs; recommendations cover package shape, schema/result contract, abort/timeouts, truncation, configuration, tests, installation, MVP/non-goals, risks, and user decisions."
    }
  ],
  "changedFiles": [
    ".trellis/tasks/08-01-pi-web-search/research/pi-extension-architecture.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "node lab/websearch-proto/src/cli.ts \"pi coding agent extension\" --engine mojeek --limit 2",
      "result": "passed",
      "summary": "Mojeek returned two results in about 1.5 seconds."
    },
    {
      "command": "node lab/websearch-proto/src/cli.ts \"pi coding agent extension\" --engine public --limit 3",
      "result": "passed",
      "summary": "Public aggregate returned three Mojeek results in about 5.1 seconds; DuckDuckGo was bot-blocked and Startpage failed."
    },
    {
      "command": "node lab/websearch-proto/src/cli.ts \"pi coding agent extension\" --engine startpage --limit 3",
      "result": "failed",
      "summary": "Startpage reached the prototype hard timeout, confirming the documented reliability limitation."
    },
    {
      "command": "pre-aborted searchPublicWeb probe with injected fetch",
      "result": "passed",
      "summary": "Probe completed and showed caller cancellation was incorrectly wrapped as an all-engines SearchProviderError, confirming the cancellation blocker."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "No staged files."
    }
  ],
  "validationOutput": [
    "Inspected all prototype source files and package metadata.",
    "Inspected Pi 0.83 extension/package/security docs and relevant extension examples.",
    "Inspected oh-my-pi tool integration, public provider, contracts, timeout/cancellation tests, aggregate tests, query pipeline tests, and MIT license.",
    "Verified current live behavior and reproduced cancellation masking without modifying source files."
  ],
  "residualRisks": [
    "Public scraper availability and terms remain external and volatile.",
    "The proposed package has not yet been implemented or loaded by Pi 0.83, so its final installation smoke test is pending.",
    "Production reliability depends on the user decision to configure a keyed backbone or accept keyless best effort."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added the requested read-only architecture research artifact; no project or source files were modified.",
  "reviewFindings": [
    "blocker: lab/websearch-proto/src/public.ts:101-124 - caller cancellation is swallowed and converted into aggregate provider failure.",
    "blocker: lab/websearch-proto/README.md:49-64 - keyless-only providers are not reliable enough for a production-reliable default.",
    "high: lab/websearch-proto/src/cli.ts:51-61 - parsed directives never pass through the implemented central lenient post-filter.",
    "high: lab/websearch-proto/src/public.ts:83-87 - Map-based consensus details are not JSON-persistence-safe.",
    "high: lab/websearch-proto/package.json:2-11 - no Pi manifest or tests exist.",
    "high: vendor/oh-my-pi/LICENSE:3-14 - substantial retained code requires explicit MIT notice preservation."
  ],
  "manualNotes": "Recommended minimum: a new packages/pi-web-search Pi package, thin web_search adapter, provider-neutral core, optional Brave fast path, hardened keyless fallback, JSON-safe bounded details, and abort/deadline regression tests."
}
```
