## Review

**Verdict: PASS** — the focused recheck found no remaining blocker or high-severity finding from the prior review.

- **Correct — response-reader cancellation:** `packages/pi-web-search/src/http.ts:55-73` now cancels the body reader on exceptional exit and rethrows the original error. `packages/pi-web-search/test/http.test.ts:27-53` observes `ReadableStream.cancel()` during a mid-body caller abort and verifies the original abort reason escapes.
- **Correct — aggregate deadlines, empties, and stragglers:** `packages/pi-web-search/test/public.test.ts:36-125` now covers all-engine empty completion, soft-deadline return, waiting past soft for first non-empty, hard-cap behavior, straggler abort, partial survival, caller cancellation, and all-engine failure.
- **Correct — fallback and provider failure semantics:** `packages/pi-web-search/test/search.test.ts:24-68` covers redacted Brave errors, Brave empty and timeout fallback, public empty success, and total operational failure. `packages/pi-web-search/test/providers.test.ts` now uses offline fixtures and exercises Brave HTTP/malformed/body/result-cap behavior plus public-engine challenge/HTTP paths.
- **Correct — lockfile scope and Vitest alignment:** `packages/pi-web-search/package.json:24-30` aligns on Vitest `^3.2.4`; `pnpm-lock.yaml:236-255` resolves Vitest 3 using the existing jiti/yaml peer set. The lockfile importer diff only replaces the obsolete `lab/websearch-proto` importer with `packages/pi-web-search`; existing app/tool importer versions remain unchanged.
- **Correct — canonical ports:** `packages/pi-web-search/src/url.ts:3-9` now uses `url.host`, preserving non-default ports. `packages/pi-web-search/test/public.test.ts:28-34` verifies distinct ports do not gain false consensus.
- **Correct — impossible dates:** `packages/pi-web-search/src/query.ts:159-163` round-trips UTC calendar components. `packages/pi-web-search/test/query.test.ts` verifies impossible dates are rejected and a valid leap day is accepted.
- **Correct — isolated Pi package-root smoke:** `packages/pi-web-search/README.md:9-14` documents `pi -ne -e $pkg`. The focused `pi -ne -e <package-root> --offline --help` smoke exited successfully with Pi 0.83.

### Residual risks

- Public search-engine HTML and anti-bot behavior remain externally volatile; this is documented and is not a blocker.
- This focused recheck did not perform a live Brave/public query or interactive Esc smoke; offline cancellation and routing contracts passed.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "review-findings: no blocker/high findings remain; exact file:line evidence confirms all prior fixes. residual-risks: public-engine volatility and unrun live/manual smoke are recorded separately."
    }
  ],
  "changedFiles": [
    "packages/pi-web-search/README.md",
    "packages/pi-web-search/package.json",
    "packages/pi-web-search/src/http.ts",
    "packages/pi-web-search/src/query.ts",
    "packages/pi-web-search/src/search.ts",
    "packages/pi-web-search/src/url.ts",
    "packages/pi-web-search/test/fixtures/brave-success.json",
    "packages/pi-web-search/test/fixtures/duckduckgo-success.html",
    "packages/pi-web-search/test/fixtures/mojeek-success.html",
    "packages/pi-web-search/test/fixtures/startpage-success.html",
    "packages/pi-web-search/test/http.test.ts",
    "packages/pi-web-search/test/providers.test.ts",
    "packages/pi-web-search/test/public.test.ts",
    "packages/pi-web-search/test/query.test.ts",
    "packages/pi-web-search/test/search.test.ts",
    "pnpm-lock.yaml"
  ],
  "testsAddedOrUpdated": [
    "packages/pi-web-search/test/http.test.ts",
    "packages/pi-web-search/test/providers.test.ts",
    "packages/pi-web-search/test/public.test.ts",
    "packages/pi-web-search/test/query.test.ts",
    "packages/pi-web-search/test/search.test.ts",
    "packages/pi-web-search/test/fixtures/brave-success.json",
    "packages/pi-web-search/test/fixtures/duckduckgo-success.html",
    "packages/pi-web-search/test/fixtures/mojeek-success.html",
    "packages/pi-web-search/test/fixtures/startpage-success.html"
  ],
  "commandsRun": [
    {
      "command": "pnpm --filter @ai-lab/pi-web-search typecheck",
      "result": "passed",
      "summary": "TypeScript completed without errors."
    },
    {
      "command": "pnpm --filter @ai-lab/pi-web-search test",
      "result": "passed",
      "summary": "Vitest 3.2.4 passed 40 offline tests across 7 files."
    },
    {
      "command": "git diff -- pnpm-lock.yaml",
      "result": "passed",
      "summary": "Existing app/tool importer versions are stable; only the obsolete lab importer is replaced by the new package importer, plus required transitive snapshots."
    },
    {
      "command": "pi -ne -e D:\\Workspace\\ai\\ai-lab\\packages\\pi-web-search --offline --help",
      "result": "passed",
      "summary": "Pi 0.83 loaded the isolated package root without an extension conflict or load error."
    },
    {
      "command": "pi -ne -e <package-root> --offline ... --provider __review_missing__",
      "result": "failed",
      "summary": "Intentional sentinel reached provider selection and failed only because the provider name was deliberately nonexistent; no extension-load error occurred."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "No staged files."
    }
  ],
  "validationOutput": [
    "Focused typecheck passed.",
    "Focused offline tests passed: 7 files, 40 tests, Vitest 3.2.4.",
    "Reader cancellation is observable during mid-body abort.",
    "Aggregate soft/hard/empty/straggler and Brave fallback semantics are covered.",
    "Existing lockfile app/tool importer resolutions remain stable.",
    "Isolated Pi 0.83 package-root load passed."
  ],
  "residualRisks": [
    "Credential-free public engine HTML and anti-bot behavior remain externally volatile.",
    "No live Brave/public query or interactive Esc smoke was run in this focused recheck."
  ],
  "noStagedFiles": true,
  "diffSummary": "Parent fixes cancel streamed readers, expand focused offline coverage, restore stable lockfile importer resolutions with Vitest 3, preserve canonical ports, validate calendar dates, and document an isolated Pi load command.",
  "reviewFindings": [
    "no blockers or high-severity findings remain"
  ],
  "manualNotes": "PASS for the requested focused recheck; no optional polish was assessed."
}
```
