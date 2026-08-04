# Pi Web Search — Implementation Plan

## Preconditions

- Task remains in `planning` until the user approves the final planning summary.
- Read `prd.md`, `design.md`, both research artifacts, and the curated context manifests before editing product code.
- Preserve all unrelated dirty files. Scope source edits to:
  - `packages/pi-web-search/**`
  - `lab/websearch-proto/**` only for graduation/removal
  - `pnpm-workspace.yaml`
  - `pnpm-lock.yaml`
- Use one writer for the active worktree.

## Validation Contract

The implementation is complete only when:

1. Pi can load a local package that registers exactly one `web_search` tool.
2. Brave-first and public-fallback routing is covered offline and observed in a focused smoke path.
3. Source-only output is bounded, deterministic, JSON-safe, and includes actual provider/attempt diagnostics without secrets.
4. Query constraints run centrally and preserve original query language.
5. Caller cancellation escapes promptly and never becomes a provider failure, even when a mocked transport ignores abort.
6. Public aggregation tolerates partial failure, enforces a wall-clock cap, and never counts two variants from one engine as two consensus votes.
7. Tests, typecheck, docs, and attribution are complete.

## Ordered Checklist

### 1. Capture baseline and protect scope

- [ ] Record `git status --short` and identify pre-existing/unrelated dirty files.
- [ ] Run the current prototype's focused Mojeek/public smoke commands once if network access is available; record results without making live tests a gate.
- [ ] Preserve a temporary copy or diff of `lab/websearch-proto` before moving/removing files because it is currently untracked.
- [ ] Confirm Node 24 and pnpm 10 versions.

**Gate:** no unrelated file has been modified or staged.

### 2. Scaffold the Pi package

- [ ] Add `packages/*` to `pnpm-workspace.yaml`.
- [ ] Create `packages/pi-web-search/package.json`, `tsconfig.json`, directory structure, and Pi manifest.
- [ ] Declare `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `typebox` as `"*"` peers, and pin their development versions exactly to `0.83.0`, `0.83.0`, and `1.3.7` for Pi 0.83 compatibility checks.
- [ ] Add only Node types, TypeScript, and Vitest beyond those compatibility dependencies.
- [ ] Update the lockfile through the workspace package manager; do not hand-edit dependency resolutions.
- [ ] Add an initial extension registration test with a fake `ExtensionAPI`.

**Verify:** package is discoverable by `pnpm --filter @ai-lab/pi-web-search ...`; the registration test sees one tool named `web_search`.

**Rollback point:** remove the package directory and workspace entry before any prototype source is removed.

### 3. Graduate and synchronize the query core

- [ ] Move/adapt the runtime-neutral query parser from the prototype into `src/query.ts`.
- [ ] Synchronize behavior against oh-my-pi snapshot `a7abeff1b7c0c94f9b63b11bd8b40d881f26a72f` without importing vendor code.
- [ ] Port the focused upstream query/constraint tests needed by the MVP.
- [ ] Keep `clampNumResults` in a suitable neutral module rather than duplicating it across adapters.
- [ ] Treat `lang:` and `language:` as literal query text in the MVP so automatic locale behavior cannot silently delete them.
- [ ] Verify queries in Chinese and English remain byte-preserved when they contain no recognized directives.

**Verify:** query tests cover directives, unknown colon tokens, Unicode/quoted phrases, date parsing, formatting, site/path matching, lenient constraint relaxation, and unchanged plain queries.

### 4. Implement contracts, bounds, and abort-safe HTTP

- [ ] Define JSON-safe request, response, source, provider-attempt, engine-stat, and tool-details types.
- [ ] Implement bounded text/URL/error normalization and HTTP(S)-only URL validation.
- [ ] Implement abort-aware `fetch` composition with per-request timeout cleanup.
- [ ] Add bounded response-body reading with a content-length precheck and streamed 2 MiB decompressed-body cap; inspect at most 16 KiB internally for errors and return at most 240 diagnostic characters.
- [ ] Distinguish caller abort from internal timeout through typed/internal errors or equivalent explicit checks.
- [ ] Race the operation against caller abort/deadline promises so a transport that ignores its signal cannot pin the tool.

**Verify:** pre-aborted, mid-flight, timeout, oversized body, malformed response, and abort-ignoring transport tests pass; timers/listeners do not keep tests/process alive.

**Risk gate:** do not proceed while caller abort is catchable as an ordinary provider error.

### 5. Implement and fixture-test providers

- [ ] Implement Brave with optional injected key, count/recency mapping, no forced language/country, bounded JSON parsing, sanitized errors, and a 10-second attempt ceiling capped by the whole-tool budget.
- [ ] Consume only ordinary `web.results`; do not retain or display Rich Search panels with separate third-party attribution obligations.
- [ ] Adapt Startpage, DuckDuckGo, and Mojeek from the prototype into the neutral provider contract.
- [ ] Remove forced US-English parameters where global/default behavior is supported.
- [ ] Keep challenge detection and result URL cleanup.
- [ ] Deduplicate canonical URLs within each engine response.
- [ ] Create offline HTML/JSON fixtures; do not assert against live websites in normal tests.

**Verify:** each adapter covers success, empty response, HTTP failure, known challenge page, result cap, query/recency mapping, original-language preservation, and no secret leakage.

### 6. Harden the public aggregate

- [ ] Extract/export canonical URL and consensus merge helpers as testable pure functions.
- [ ] Count distinct engine IDs, not duplicate result rows, for consensus.
- [ ] Implement deterministic engine-order tie breaks and longest-snippet merge.
- [ ] Implement partial failure, empty completion, soft deadline, first-nonempty wait, hard deadline, and straggler abort.
- [ ] Return only plain JSON engine metadata.

**Verify:** aggregate tests cover all ranking and deadline invariants, including a transport that ignores abort.

### 7. Implement Brave-first orchestration and central filtering

- [ ] Resolve only `BRAVE_API_KEY` and `PI_WEB_SEARCH_MODE` at execution time; keep the public engine tuple fixed in the MVP.
- [ ] Validate mode when the tool executes, not during extension loading.
- [ ] Enforce a 30-second whole-tool ceiling; cap Brave/public/request deadlines by the remaining budget.
- [ ] Implement `auto`: Brave when keyed, then public on empty/error/timeout; no-key goes directly to public.
- [ ] Implement forced `public` operator mode.
- [ ] Parse the query once and centrally apply lenient post-filtering to the selected result.
- [ ] Preserve bounded attempt diagnostics across fallback.
- [ ] Define total-failure versus completed-empty semantics exactly as in `design.md`.

**Verify:** search orchestration tests cover every branch, central constraint notes, caller abort during Brave and public fallback, and JSON serialization.

### 8. Implement bounded formatting and the Pi adapter

- [ ] Format source-only text with stable numeric indexes and URLs.
- [ ] Apply field caps (title 200 characters, snippet 240, date 80, URL 2,048, diagnostics 240); discard invalid/overlong URLs rather than breaking them by truncation.
- [ ] Retain complete entries only while text stays within 24 KiB and serialized details within 32 KiB; keep indexes/text/details aligned.
- [ ] Apply Pi's truncation utility only as a final defensive guard and set `details.truncated` accurately.
- [ ] Register the strict TypeBox schema using `StringEnum` for recency.
- [ ] Add prompt metadata that identifies snippets as untrusted evidence.
- [ ] Forward Pi's tool `AbortSignal` without replacement or masking.
- [ ] Do not add custom rendering, commands, nested model calls, or global state.

**Verify:** formatter and extension tests cover stable content, exact schema/name, signal identity/forwarding, JSON round-trip, and output truncation.

### 9. Documentation and attribution

- [ ] Write README sections for capability, source-only semantics, installation, configuration, provider/fallback behavior, privacy, reliability, query syntax, testing, and troubleshooting.
- [ ] Document that public fallback fans out queries and public HTML adapters are best-effort.
- [ ] Apply `research/brave-api-usage.md`: ordinary Brave attribution is optional, Rich Search is excluded, plain provider diagnostics must not imply partnership, and future Rich Search/UI/storage/publication changes require a terms re-check.
- [ ] Add `THIRD_PARTY_NOTICES.md` with the full upstream MIT notice and adapted-file provenance.
- [ ] Record the oh-my-pi source snapshot commit.
- [ ] Preserve the prototype's measured reliability findings without presenting them as guaranteed current behavior.

**Verify:** docs commands/paths match the actual package manifest and extension entry point.

### 10. Graduate the prototype and run full checks

- [ ] Confirm the package contains every retained prototype capability before removing the old runnable prototype.
- [ ] Remove `lab/websearch-proto` implementation/package files so there is one source of truth; migrate any still-useful README content first.
- [ ] Run:

```powershell
pnpm --filter @ai-lab/pi-web-search typecheck
pnpm --filter @ai-lab/pi-web-search test
pnpm --filter @ai-lab/pi-web-search check
```

- [ ] Inspect the final package dependency tree/manifest and lockfile diff; run `npm pack --dry-run ./packages/pi-web-search` to verify package contents.
- [ ] Run a focused live core smoke when network/key availability permits; keep it non-gating.
- [ ] Resolve `packages/pi-web-search` to an absolute path and load the package root with `pi -e <absolute-package-path>`; this mandatory smoke validates `package.json#pi.extensions`.
- [ ] Optionally load `extensions/index.ts` directly only as a secondary entry-file diagnostic.
- [ ] In Pi, observe one success, public/no-key fallback, a controlled failure, and Esc cancellation where feasible.
- [ ] Re-run offline checks after any smoke-test fix.

**Final gate:** all automated checks pass; manual limitations are explicitly recorded; no unrelated files are changed or staged.

## Review Plan

After the implementation writer finishes:

1. Fresh correctness/cancellation review against PRD and design.
2. Fresh tests/validation review, including whether the changed code actually executed.
3. Fresh simplicity/security review for secret leakage, untrusted snippets, unnecessary provider abstraction, and output bounds.
4. Parent synthesizes findings; one writer applies accepted fixes.
5. Re-run affected checks and inspect the final diff.

## High-Risk Areas

- `src/http.ts`: caller abort versus timeout, timer cleanup, body caps.
- `src/public.ts`: wall-clock race, late stragglers, deterministic consensus votes.
- `src/search.ts`: fallback semantics, whole-tool budget, and secret-free errors.
- `src/query.ts`: large adapted algorithm and upstream drift.
- `extensions/index.ts`: Pi 0.83 schema/result compatibility.
- `pnpm-lock.yaml`: avoid unrelated lockfile churn.
- removal of `lab/websearch-proto`: only after the package is green.

## Rollback

If a gate fails and cannot be corrected within scope:

- restore the saved prototype copy/diff;
- remove the new package and `packages/*` workspace entry;
- restore the prior lockfile;
- leave user Pi settings untouched;
- record the failed gate and residual risk in the task research instead of shipping a partially reliable extension.
