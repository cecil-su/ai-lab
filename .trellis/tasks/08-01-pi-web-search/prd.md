# Extract oh-my-pi Web Search for Pi

## Goal

Provide Pi with an installable `web_search` tool derived from oh-my-pi's web-search design, while avoiding runtime coupling to the vendored oh-my-pi application.

The result should preserve the useful query parsing, provider fallback/aggregation, source formatting, and cancellation behavior needed by a coding agent, and be maintainable as an independent package in this monorepo.

## Background and Confirmed Facts

- `lab/websearch-proto` is a useful feasibility prototype, not a production Pi integration:
  - it contains the Google-style query parser, three credential-free scraper adapters, and parallel consensus aggregation;
  - it exposes only a standalone CLI and has no Pi manifest, extension entry point, or tests;
  - it intentionally omits oh-my-pi's browser fallback, provider chain, central post-filter pipeline, bounded tool output, and Pi-facing result contract.
- A live run on 2026-08-01 confirmed the prototype still returns results, but only through Mojeek:
  - Mojeek returned results in about 1.5 seconds;
  - aggregate mode returned after about 5 seconds with Mojeek results;
  - DuckDuckGo was bot-challenged and Startpage failed.
- The prototype currently masks caller cancellation as an aggregate provider failure, uses a non-JSON-safe `Map` in details, and does not apply its lenient query-constraint post-filter centrally.
- Current oh-my-pi implements a much broader provider registry and sequential fallback chain; its explicit `public` provider separately fans out across credential-free engines.
- oh-my-pi's code is MIT-licensed. Any substantial copied or adapted code must retain the upstream copyright and permission notice.
- Pi 0.83 can load a raw TypeScript extension from a local Pi package declared through `package.json#pi.extensions`; a subprocess wrapper around the prototype CLI is unnecessary.

## Requirements

### Functional

- Expose one Pi custom tool named `web_search`.
- Accept a required query plus bounded result count and optional recency filter.
- Return deterministic, citation-friendly source entries containing title, URL, and optional bounded snippet/date metadata; Pi's active model, rather than a nested model call inside the package, is responsible for synthesizing the final answer.
- Preserve Google-style query directives already supported by the prototype, with central lenient post-filtering when a provider cannot enforce them natively.
- Preserve the query's original language. Do not force US-English request parameters; let Brave infer language and use global/default-region behavior for public engines without exposing model-facing language or country arguments in the MVP.
- Use the approved MVP provider policy: Brave Search API is the preferred reliable path when `BRAVE_API_KEY` is configured; otherwise, or when Brave fails, fall back to the credential-free public aggregate.
- Keep the public aggregate available as a forced best-effort mode for diagnostics and no-key use.
- Support provider failure without losing successful results from another configured provider/engine.
- Preserve caller cancellation and stop outstanding network work when Pi aborts the tool call.
- Keep tool result details plain-JSON serializable and bounded for Pi session persistence.

### Packaging and Maintainability

- Deliver an independently installable local Pi package; do not import runtime code from `vendor/oh-my-pi`.
- Keep the Pi extension adapter thin and separate from a provider-neutral search core.
- Reuse only verified prototype/upstream algorithms and add focused regression tests before treating them as production code.
- Include installation/configuration documentation and the required upstream MIT notice/provenance.
- Keep browser automation, OAuth stores, and oh-my-pi application globals out of the base package unless explicitly approved later.

### Quality

- Add offline fixture/unit tests for query parsing, aggregation/dedup/ranking, partial/all-provider failure, empty results, deadlines, cancellation, result bounds, JSON serialization, and Pi tool registration/signal forwarding.
- Keep live-network smoke tests opt-in and non-blocking for normal validation.
- Verify the package by typecheck, offline tests, local Pi loading, one successful query, one failure path, and an Esc/cancellation smoke test.

## Acceptance Criteria

- [ ] Pi loads the local package and registers exactly one active `web_search` tool without importing oh-my-pi at runtime.
- [ ] With a valid `BRAVE_API_KEY`, automatic mode uses Brave as the primary provider and returns its sources without unnecessary public-engine fan-out.
- [ ] Without a Brave key, or when Brave fails, automatic mode falls back to the public aggregate and reports the provider actually used.
- [ ] A successful tool call returns bounded source text and JSON-safe structured details in stable ranked order, without making a nested LLM request.
- [ ] Supported query directives are parsed once and centrally post-filtered with visible relaxation notes when a constraint would otherwise eliminate every result.
- [ ] Chinese, English, and other-language queries are preserved without forced US-English parameters; no model-facing locale fields are added.
- [ ] Partial provider/engine failure still returns surviving sources; total operational failure is reported clearly.
- [ ] Pre-aborted and mid-flight caller cancellation terminate promptly and are not rewritten as provider failures.
- [ ] Output/result/body limits prevent unbounded data from entering Pi context or session details.
- [ ] Offline tests cover the core contracts and pass together with typecheck.
- [ ] README documents local installation, configuration, reliability/privacy caveats, and live smoke testing.
- [ ] The package carries the upstream MIT notice and copied-file provenance.

## Out of Scope Unless Later Approved

- Copying the complete oh-my-pi provider/auth/settings stack; that is a possible post-MVP evolution, not part of this task.
- Importing or executing code directly from `vendor/oh-my-pi`.
- Headless Puppeteer/stealth/CAPTCHA solving in the base package.
- Publishing the package to npm.
- Search-result page extraction, browser navigation, caching, or history.
- Nested-LLM answer synthesis, token accounting, or an additional model/provider credential path inside the search package.
- Custom TUI rendering or a standalone CLI as an MVP requirement.

## Key Decisions

- MVP uses option B: Brave Search API first when configured, with the credential-free public aggregate as no-key and failure fallback.
- MVP returns ranked sources only. Pi's existing active model synthesizes answers from those sources; the extension does not make a nested LLM call.
- MVP uses automatic language detection and global/default-region search behavior; it does not expose `language` or `country` to the model.
- The full oh-my-pi provider ecosystem is deferred. The core should permit later provider additions without implementing their auth/settings stacks now.

## Research

- `research/prototype-vs-upstream.md`
- `research/pi-extension-architecture.md`
- `research/planning-review.md`
- `research/brave-api-usage.md`
- `research/final-plan-review.md`
- `research/final-plan-recheck.md`
- `research/implementation-handoff.md`
- `research/implementation-review.md`
