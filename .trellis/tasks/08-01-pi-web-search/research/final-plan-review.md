# Final Planning-Gate Review

## Review

- **High — package-manifest loading is not actually validated.** The PRD requires Pi to load the local **package** (`prd.md:41,51,55`), but the only required smoke command loads the entry file directly (`design.md:347-348`; `implement.md:144-147`). That bypasses `package.json#pi.extensions`, so a broken package root or manifest could pass. The package install is merely optional (`design.md:353`). **Smallest correction:** make a package-root smoke mandatory, using `pi -e <absolute packages/pi-web-search path>` as already proposed in `research/planning-review.md:293-299`, or use an isolated temporary `PI_CODING_AGENT_DIR` for install/list/remove validation. Keep the direct-file load only as a secondary extension-entry diagnostic.

- **High — the Pi 0.83 compatibility dependency versions are no longer pinned.** The architecture research explicitly requires exact `0.83.0` development dependencies (`research/pi-extension-architecture.md:78`), and the earlier planning review repeats that requirement (`research/planning-review.md:54`). The authoritative design weakens this to unspecified “Pi 0.83-compatible packages” (`design.md:75-76`), while `implement.md:40-42` also omits exact versions. A fresh install could therefore typecheck against a later Pi API and fail to attest 0.83 compatibility. The installed target is `@earendil-works/pi-coding-agent` 0.83.0 and uses `typebox` 1.3.7 (`C:/Users/shuxingxing/scoop/apps/pi-coding-agent/0.83.0/package.json:2-3,43,57`). **Smallest correction:** require exact `0.83.0` dev dependencies for directly imported Pi packages and exact `typebox` 1.3.7, while retaining `"*"` only in `peerDependencies` as Pi requires.

- **High — Brave attribution/usage obligations remain an acknowledged but unclosed planning risk.** The research says current Brave API terms and possible display-attribution obligations must be checked before claiming compliance (`research/planning-review.md:371`), but the authoritative attribution section covers only oh-my-pi’s MIT notice (`design.md:314-324`), and the implementation documentation checklist does not add a Brave-terms verification step (`implement.md:120-127`). This could discover a requirement that conflicts with the approved source-only/no-custom-rendering scope only after implementation begins. **Smallest correction:** add a pre-provider gate to record the current Brave Search API usage/attribution requirements and implement/document the required text attribution; if they require UI, logo, storage, or display behavior outside the MVP, return to planning for explicit scope approval.

## Verdict

**FAIL — not ready for user approval.** The functional design otherwise converges on the requested Brave-first/public-fallback, sources-only, locale/lang-token, deadline, cancellation, bounds, test, MIT provenance, and rollback contracts. Resolve the three high findings above; no broader redesign is needed.

## Residual risks after correction

- Public HTML adapters and bot defenses remain volatile; fixture tests cannot guarantee live availability.
- Live Brave, package-loading, and Esc-cancellation smoke results still depend on implementation-time credentials and environment access.
- An arbitrary transport that ignores abort may continue internally after the bounded tool result returns, although the plan correctly bounds user-visible latency.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Three high findings cite exact PRD, design, implementation, research, Pi documentation/package, and manifest-validation evidence; each includes the smallest correction, and residual risks are listed."
    }
  ],
  "changedFiles": [
    ".trellis/tasks/08-01-pi-web-search/research/final-plan-review.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "python .trellis/scripts/task.py validate .trellis/tasks/08-01-pi-web-search",
      "result": "passed",
      "summary": "implement.jsonl validated with four entries and check.jsonl with three entries."
    },
    {
      "command": "pi --help",
      "result": "passed",
      "summary": "Confirmed the installed Pi CLI exposes extension/package-source loading and tool allowlisting options."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "No staged files were present."
    }
  ],
  "validationOutput": [
    "Read prd.md, design.md, implement.md, all three research artifacts, both curated JSONL manifests, and task.json.",
    "Verified pnpm-workspace.yaml currently lacks packages/* and that the planned workspace expansion is necessary.",
    "Verified Pi 0.83 package manifest, peer dependency, raw-TypeScript/jiti, StringEnum, tool-error, and CLI assumptions against the installed Pi 0.83 documentation and package metadata.",
    "Curated JSONL manifests pass Trellis validation."
  ],
  "residualRisks": [
    "Public scraper availability and bot defenses remain externally volatile.",
    "Live Brave, package-load, and Esc-cancellation smoke tests remain implementation-time manual gates.",
    "Abort-ignoring third-party transport work may outlive the bounded tool call internally."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added only the requested final planning-gate review artifact; no product or planning source files were modified.",
  "reviewFindings": [
    "high: prd.md:41,51,55; design.md:347-353; implement.md:144-147 - required smoke loads the extension file rather than validating the local package manifest.",
    "high: design.md:75-76; implement.md:40-42 - exact Pi 0.83 development dependency pins from research/pi-extension-architecture.md:78 are not carried into the authoritative plan.",
    "high: research/planning-review.md:371; design.md:314-324; implement.md:120-127 - Brave API usage/display-attribution obligations are acknowledged but have no closure gate."
  ],
  "manualNotes": "Verdict is fail pending three small planning corrections; the core functional architecture does not need redesign."
}
```
