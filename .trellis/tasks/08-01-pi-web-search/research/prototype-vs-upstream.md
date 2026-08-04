# Code Context

## Decision

**Discard the prototype as an implementation shell and rebuild the integration around a small provider-neutral search core.** Salvage the query parser and the consensus-merge algorithm (with tests and attribution), but do not evolve the prototype CLI/engine wiring into the product.

The prototype proved one useful idea, but its own measurement found only Mojeek reliable and DDG/Startpage blocked (`lab/websearch-proto/README.md:35-54`). Its public aggregate therefore usually has one vote, defeating consensus ranking. Upstream has since diverged materially and supplies the missing operational, provider-chain, tool, settings, rendering, cancellation, and test behavior.

## Files Retrieved

1. `lab/websearch-proto/src/query.ts` (lines 1-690) - near-verbatim reusable directive parser/filter.
2. `lab/websearch-proto/src/public.ts` (lines 1-147) - three-engine fan-out and consensus algorithm.
3. `lab/websearch-proto/src/fetch.ts` (lines 1-78) - deliberately reduced plain-fetch transport.
4. `lab/websearch-proto/src/types.ts` (lines 1-51) - prototype-only reduced contract.
5. `lab/websearch-proto/src/engines/{duckduckgo,mojeek,startpage}.ts` (full files; exported searches at lines 128, 91, 149 respectively) - keyless adapters.
6. `lab/websearch-proto/src/cli.ts` (lines 1-91) - only integration surface.
7. `lab/websearch-proto/README.md` (lines 1-69) and `package.json` (lines 1-13) - claims, measured behavior, runtime scope.
8. `vendor/oh-my-pi/packages/coding-agent/src/web/search/index.ts` (lines 62-365) - formatting, fallback executor, CLI/tool entry points.
9. `vendor/oh-my-pi/packages/coding-agent/src/web/search/provider.ts` (lines 1-260) - lazy registry, configured ordering/exclusions, instance cache.
10. `vendor/oh-my-pi/packages/coding-agent/src/web/search/types.ts` (lines 1-140) - 24-provider option/order metadata and richer response model.
11. `vendor/oh-my-pi/packages/coding-agent/src/web/search/providers/base.ts` (lines 1-115) - auth/session/provider boundary.
12. `vendor/oh-my-pi/packages/coding-agent/src/web/search/providers/public.ts` (lines 17-199) - current five-engine aggregate and explicit-only provider.
13. `vendor/oh-my-pi/packages/coding-agent/src/web/search/providers/browser-page.ts` (lines 1-126) - fetch-to-headless escalation and browser-registry coupling.
14. `vendor/oh-my-pi/packages/coding-agent/src/tools/index.ts` (lines 35, 411, 559) - built-in registration and enabled setting.
15. `vendor/oh-my-pi/packages/coding-agent/src/cli/web-search-cli.ts` (lines 1-approximately 120) and `commands/web-search.ts` (lines 1-45) - command integration.
16. `vendor/oh-my-pi/packages/coding-agent/test/tools/web-search-public.test.ts` (lines 1-204) - consensus, partial failure, deadlines, cancellation, all-failed/excluded coverage.
17. `vendor/oh-my-pi/packages/coding-agent/test/web/search/{query,query-pipeline,provider-chain,abort-and-timeout}.test.ts` and provider tests - broad behavior absent from prototype.
18. `vendor/oh-my-pi/docs/tools/web_search.md` (lines 1-289) - documented contract, provider scope, failure semantics and coupling.
19. `vendor/oh-my-pi/LICENSE` (lines 1-21) - MIT grant and notice-retention condition.

## Key Code

### Faithful/reusable

- `parseSearchQuery`, `formatQuery`, `formatScraperQuery`, `applyQueryConstraints`, `matchesSite`, and `clampNumResults` in `lab/websearch-proto/src/query.ts:165-690` closely preserve upstream behavior. This is the strongest reusable file, though the upstream file now has substantial documentation/evolution; a no-index diff showed 171 additions/14 deletions in upstream relative to the prototype.
- Consensus mechanics in `lab/websearch-proto/src/public.ts:39-82,125-147` remain aligned with upstream: canonicalize host/path, retain longest snippet, rank by engine count then best rank then insertion order (`vendor/.../providers/public.ts:57-104,163-178`). Reuse these symbols as extracted pure functions, not the current module wiring.
- Minimal domain types `SearchSource` and `SearchProviderError` (`lab/websearch-proto/src/types.ts:9-49`) are useful concepts, but the production contract must allow answer, citations, related queries, usage/auth metadata represented upstream.

### Behavioral gaps / findings

- **high — provider breadth is misleading:** prototype aggregate hardcodes only Startpage, DDG, Mojeek (`lab/websearch-proto/src/public.ts:20-24`); current upstream public aggregate uses Startpage, Google, DDG, Ecosia, Mojeek (`vendor/.../providers/public.ts:17-23`), while the full configured chain spans native/API/MCP/keyless providers (`vendor/.../types.ts:7-89`). Prototype is not a web-search product, only a fragile scraper experiment.
- **high — transport fidelity:** prototype uses one static-header fetch and a 15s timer (`lab/websearch-proto/src/fetch.ts:20-75`). Upstream escalates through shared browser acquisition (`vendor/.../providers/browser-page.ts:5,36-126`). Prototype explicitly admits DDG and Startpage fail (`README.md:35-54`) and Mojeek cannot solve ALTCHA (`engines/mojeek.ts:91-113`).
- **high — no tool integration:** prototype ends at a console CLI (`lab/websearch-proto/src/cli.ts:13-91`). Upstream has sequential availability fallback and normalized non-throwing tool errors (`vendor/.../index.ts:132-257`), a model-facing `WebSearchTool` (`index.ts:301-365`), registration and per-session enable gating (`tools/index.ts:411,559`), plus a slash command. This cannot be added safely by merely wrapping `searchPublicWeb`.
- **high — no tests:** prototype contains no test files or test script (`lab/websearch-proto/package.json:1-13`). Upstream tests deadline/abort behavior, dedup ordering, exclusions and aggregate errors (`test/tools/web-search-public.test.ts:67-204`) plus query/provider-chain/timeout and adapter suites. Regex parser ports especially need fixture tests before reuse.
- **medium — public timing/API drift:** prototype hardcodes a 20s hard deadline and exposes no deadline seam (`lab/websearch-proto/src/public.ts:27-30,90-93`); upstream uses 30s, injectable deadlines, composed hard timeout, provider exclusions, and registry lookup (`vendor/.../providers/public.ts:39-50,117-159`). Prototype can return empty when engines are still pending, but cannot distinguish/configure exclusions.
- **medium — parser claims are stale:** `query.ts` says “ported verbatim” (`lab/websearch-proto/src/query.ts:1-12`), but current upstream differs substantially. Treat it as a fork requiring synchronization and upstream query tests, not a source of truth.
- **medium — scraper parsing regression risk:** prototype deliberately replaces DOM parsing with regex and static headers (`README.md:27-33`). Diff stats show current upstream divergence of 83/12 lines for DDG, 152/54 for Mojeek, and 103/47 for Startpage. These adapters are not faithful reusable ports now.
- **medium — hidden coupling upstream must not be copied wholesale:** provider params require `AuthStorage`, `ModelRegistry`, system prompt and session identity (`vendor/.../providers/base.ts:1-91`); registry behavior is module-global; browser transport imports the coding-agent browser registry (`browser-page.ts:5`). Copying providers directly would drag pi auth refresh rules, Bun APIs, settings globals, browser lifecycle/native dependencies, and rendering conventions.
- **medium — licensing/attribution:** upstream is MIT, but substantial copies must include its copyright and permission notice (`vendor/oh-my-pi/LICENSE:1-21`). Prototype comments mention MIT but the prototype directory has no LICENSE/NOTICE and package metadata has no `license` field (`lab/websearch-proto/package.json:1-13`). Any retained parser/merge/scraper code needs explicit notice preservation and provenance.
- **low — docs drift:** upstream docs describe more engines than current source in at least one Public Web passage, while source is authoritative. Generate provider lists from registry metadata rather than duplicating prose.

## Architecture

Upstream flow is: model tool/CLI command → `executeSearch` → configured lazy provider candidates → provider `search(SearchParams)` → shared directive post-filter → LLM formatter/render details. Auto fallback is sequential; only explicit `public` performs parallel keyless fan-out. Settings initialize order/exclusions and gate `web_search.enabled`; auth and model registry are passed through the session.

The prototype collapses that to CLI → three hardcoded engine functions → optional parallel merge. It omits the application boundary and duplicates transport/parser concerns inside a lab package.

### Recommended boundary

Build a standalone, runtime-neutral core with:

1. `SearchSource`, `SearchResponse`, `SearchRequest`, `SearchProvider` interfaces (no `AuthStorage`, settings globals, Bun, TUI, or browser registry).
2. The synchronized `query.ts` algorithms and pure `canonicalUrlKey`/`mergeConsensusSources` helpers.
3. An orchestrator supporting sequential fallback and an explicitly selected aggregate strategy, injected clock/deadlines/fetch/providers, and consistent AbortSignal semantics.
4. Separate adapters: start with one reliable keyed provider (product choice: Brave/Tavily/Exa/SearXNG) plus at most one best-effort keyless provider. Add browser-backed scraping only behind an optional adapter/package.
5. A thin pi plugin/tool layer for schema, settings, credential resolution, formatter and command. Do not import upstream `provider.ts`, `base.ts`, `browser-page.ts`, or `tools/index.ts` directly.

Exact reuse candidates: `lab/websearch-proto/src/query.ts` symbols listed above after syncing/tests; algorithmic bodies of `dedupKey` and `mergeSources` from `public.ts:39-82` (rename/export/test); `SearchSource` shape from `types.ts:9-20`. Rebuild all engine modules, `fetch.ts`, `public.ts` orchestration, and `cli.ts`.

## Risks and open product decisions

- Decide whether “web search” must synthesize an answer/citations or only return SERP sources; prototype supports only sources, upstream supports both.
- Decide reliable default/provider budget and credential UX. Keyless-only is demonstrably unreliable; API-first changes cost/privacy expectations.
- Decide whether consensus is worth parallel latency/network load when only one or two dependable providers are configured.
- Decide if headless browser weight, bot-challenge/legal/ToS exposure, and ongoing scraper maintenance are acceptable. If not, exclude Google/Ecosia/Mojeek-style adapters.
- Decide provider selection visibility: model schema upstream hides provider while internal CLI/settings can force it.
- Pin an upstream commit and preserve MIT notice; otherwise future “faithful port” assertions will drift again.
- Residual evidence risk: no live network benchmark was rerun; reliability conclusions use the prototype's dated recorded measurement. No prototype tests exist to attest current runtime behavior.

## Start Here

Open `vendor/oh-my-pi/packages/coding-agent/src/web/search/index.ts:132-257` first: it defines the actual product semantics (selection, fallback, cancellation, filtering, error normalization). Then design the neutral boundary before copying any provider.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete severity-ranked findings cite prototype and upstream source, integration, tests, docs, and license paths/lines; residual risks and exact reusable symbols are listed."
    }
  ],
  "changedFiles": [
    ".trellis/tasks/08-01-pi-web-search/research/prototype-vs-upstream.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git diff --no-index --stat for query.ts and three scraper pairs",
      "result": "passed",
      "summary": "Confirmed material upstream divergence; diff exits nonzero by design when differences exist."
    }
  ],
  "validationOutput": [
    "Inspected prototype source/package/docs and upstream core, providers, integration, tests, docs, and MIT license.",
    "Verified the prototype directory has no tests and only three aggregate engines."
  ],
  "residualRisks": [
    "No live provider/network benchmark was rerun; reliability evidence is the prototype README's 2026-07-27 measurement.",
    "Provider terms of service and jurisdiction-specific scraping legality were not assessed."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added research artifact only; no project/source files modified.",
  "reviewFindings": [
    "high: lab/websearch-proto/src/public.ts:20-24 - only three brittle keyless engines, so it does not match upstream provider scope.",
    "high: lab/websearch-proto/src/fetch.ts:48-75 - no headless fallback despite measured bot challenges.",
    "high: lab/websearch-proto/package.json:1-13 - no test suite or test script for copied parser/scrapers/deadline logic.",
    "medium: vendor/oh-my-pi/LICENSE:1-21 - retained substantial code requires MIT notice preservation."
  ],
  "manualNotes": "Recommendation: rebuild the shell/integration; salvage synchronized query and pure consensus algorithms with upstream tests and attribution."
}
```
