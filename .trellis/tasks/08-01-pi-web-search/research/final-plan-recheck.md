# Final Planning Recheck

## Review

**PASS — all three prior blockers are resolved, with no new internal contradiction among the reviewed artifacts.**

- **Correct — package-root Pi smoke is now mandatory.** `design.md:348-356` requires resolving the package root to an absolute path and loading it with `pi -e <absolute packages/pi-web-search path>`, explicitly says this validates `package.json#pi.extensions`, and makes direct `extensions/index.ts` loading secondary/optional. `implement.md:145-150` repeats the same mandatory package-root gate. This now directly supports the package-loading requirements in `prd.md:41,51,55`.
- **Correct — exact Pi 0.83/typebox development pins are restored.** `design.md:74-76` distinguishes Pi-required `"*"` peer ranges from exact development pins and requires `@earendil-works/pi-coding-agent@0.83.0`, `@earendil-works/pi-ai@0.83.0`, and `typebox@1.3.7`. `implement.md:37-46` carries the same exact versions into the scaffold checklist. There is no contradiction between wildcard peers and exact dev dependencies because the artifacts assign them to different dependency sections for different purposes.
- **Correct — Brave attribution/usage scope is closed for the MVP.** `research/brave-api-usage.md:5-20` records the official source URLs and the relevant attribution, Rich Search, authentication, and endpoint findings; `research/brave-api-usage.md:24-32` makes the closure decision to consume only ordinary `web.results`, avoid Rich Search panels, omit optional Brave branding, retain non-partnership provider diagnostics, reopen planning for scope changes, and document account/quota/privacy/terms caveats. `design.md:230-236,315-326` incorporates those restrictions and the recheck trigger. `implement.md:76-77,122-131` turns them into provider and documentation checklist items. The plain `Provider: brave` diagnostic is consistently treated as factual provider reporting rather than optional branded `POWERED BY BRAVE` treatment; no reviewed artifact asks for a logo or implies endorsement.
- **Correct — JSONL manifests preserve the closure evidence.** `implement.jsonl:3-5` includes the Pi architecture, planning review, and Brave usage research needed during implementation. `check.jsonl:2-5` includes those sources plus `final-plan-review.md` and explicitly instructs review to verify that the three blockers remain resolved. Both manifests validate successfully with five entries each.
- **Note — residual external risk, not a planning blocker.** `research/brave-api-usage.md:22` says direct extraction of the JavaScript-backed terms page failed and the conclusions were based on consistent official-domain search results. The plan bounds that uncertainty by requiring a terms recheck if response shape/usage changes (`research/brave-api-usage.md:22,30`; `design.md:326`; `implement.md:126`). Current terms can still change before release, but this does not create an internal contradiction in the present plan.

## Verdict

**PASS.** No remaining blocker was found within the requested three-finding recheck.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "The review gives concrete PASS findings with exact paths and line ranges for package-root smoke, exact Pi/typebox development pins, Brave attribution/usage closure, JSONL manifest coverage, and the only residual external risk."
    }
  ],
  "changedFiles": [
    ".trellis/tasks/08-01-pi-web-search/research/final-plan-recheck.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "python .trellis/scripts/task.py validate .trellis/tasks/08-01-pi-web-search",
      "result": "passed",
      "summary": "implement.jsonl and check.jsonl both validated with five entries."
    },
    {
      "command": "rg -n 'package-root|pi -e|0\\.83\\.0|1\\.3\\.7|Rich Search|attribution|web\\.results' prd.md design.md implement.md research/brave-api-usage.md check.jsonl implement.jsonl",
      "result": "passed",
      "summary": "Located and cross-checked package-root, version-pin, Brave usage/attribution, and manifest evidence."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "No staged files were present before writing this requested review artifact."
    }
  ],
  "validationOutput": [
    "Mandatory package-root Pi smoke appears consistently in design.md:350-351 and implement.md:147-148.",
    "Exact dev pins 0.83.0, 0.83.0, and 1.3.7 appear consistently in design.md:75-76 and implement.md:41.",
    "Brave ordinary-web-results-only and attribution closure appears consistently in research/brave-api-usage.md:24-32, design.md:230-233,315-326, and implement.md:76-77,122-131.",
    "Trellis context validation passed for both five-entry JSONL manifests."
  ],
  "residualRisks": [
    "Brave terms are externally mutable, and direct extraction of the JavaScript-backed terms page failed during research; the plan requires reopening the terms decision when response shape or usage scope changes."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added only the requested read-only planning recheck artifact; no product or authoritative planning files were changed.",
  "reviewFindings": [
    "no blockers: package-root Pi smoke is mandatory in design.md:350-351 and implement.md:147-148.",
    "no blockers: exact Pi/typebox dev pins are specified in design.md:75-76 and implement.md:41.",
    "no blockers: Brave attribution/usage scope is closed in research/brave-api-usage.md:24-32 and incorporated by design.md:326 and implement.md:126."
  ],
  "manualNotes": "Review scope was limited to the three prior blockers and whether their corrections introduced contradictions in prd.md, design.md, implement.md, research/brave-api-usage.md, and the JSONL manifests."
}
```
