# Pi Web Search Contract

## 1. Scope / Trigger

Use this contract when changing `packages/pi-web-search`, adding a search provider, or implementing another networked Pi extension that persists structured tool details.

The boundary is: Pi extension schema → provider-neutral orchestrator → external HTTP providers → bounded text and JSON-safe tool result.

## 2. Signatures

Pi registers exactly one model-facing tool:

```ts
web_search({
  query: string; // trimmed, 1..2000 characters
  recency?: "day" | "week" | "month" | "year";
  limit?: number; // integer, 1..20, default 10
}): Promise<{
  content: [{ type: "text"; text: string }];
  details: WebSearchDetails;
}>;
```

Core entry point:

```ts
executeWebSearch(
  input: WebSearchInput,
  signal?: AbortSignal,
  dependencies?: SearchDependencies,
): Promise<WebSearchResult>;
```

Package root must declare:

```json
{
  "pi": { "extensions": ["./extensions/index.ts"] }
}
```

## 3. Contracts

### Environment

| Key | Required | Contract |
|-----|----------|----------|
| `BRAVE_API_KEY` | No | When non-empty in `auto`, Brave is attempted first; send only in `X-Subscription-Token` |
| `PI_WEB_SEARCH_MODE` | No | `auto` (default) or `public`; invalid values fail at tool execution, not extension load |

Do not add model-facing provider, locale, key, engine-order, or timeout fields without a product decision.

### Routing

1. `public` mode skips Brave.
2. `auto` without key uses public directly.
3. `auto` with key tries Brave.
4. Non-empty Brave results return without public fan-out.
5. Brave empty/error/internal-timeout falls back to public.
6. Caller abort never falls back.
7. At least one normal empty attempt allows a normal empty result; every path failing operationally throws.

### Details

`WebSearchDetails` is plain JSON and includes schema version, mode, actual provider, indexed bounded sources, provider attempts, public-engine attempts, relaxed constraints, elapsed time, and truncation flag. Never persist `Map`, `Set`, `Error`, `Response`, signals, readers, headers, or credentials.

### Limits

- whole tool: 30 seconds
- Brave attempt: 10 seconds
- public soft/hard: 5/20 seconds
- public request: 15 seconds, capped by remaining budgets
- response body: 2 MiB decompressed bytes
- title/snippet/date/URL/diagnostic: 200/240/80/2048/240 characters
- formatted text/details: 24/32 KiB

Drop trailing source entries atomically so text indexes and `details.sources[].index` always agree. Invalid or overlong URLs are discarded, not truncated.

### Query and locale

Preserve the original script/language and do not force `Accept-Language`, country, or search-language parameters. `lang:` and `language:` are literal query terms. Recognized directives are parsed once and centrally post-filtered; a constraint that would eliminate every source is relaxed and reported.

### Provider safety

Consume only Brave ordinary `web.results`, not Rich Search panels. Search snippets are untrusted evidence, never instructions. Public fallback may transmit one query to Startpage, DuckDuckGo, and Mojeek.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|-----------|-------------------|
| Empty/overlong query | Throw before network work |
| Invalid mode | Throw before network work |
| Caller signal already/mid-flight aborted | Reject with the original `signal.reason`; do not start fallback |
| Internal provider timeout | Record `timeout`; fallback when policy permits |
| Brave 401/403/429/5xx or malformed/oversized response | Safe bounded provider error; never include key/body |
| One public engine fails | Return surviving sources and diagnostics |
| Every public engine fails/times out | Throw provider-unavailable error |
| At least one engine completes empty and none finds sources | Normal `No results found` result |
| Response stream abort/error | Best-effort `reader.cancel(error)`, release lock, preserve original reason |
| Output/details exceeds cap | Drop complete trailing entries and set `truncated: true` |

## 5. Good / Base / Bad Cases

- **Good:** keyed Brave returns sources quickly; no public request occurs.
- **Base:** no key; public aggregate returns Mojeek results while other engines are challenged.
- **Valid empty:** providers complete normally with zero sources; tool returns `No results found`.
- **Bad operational:** all providers fail; tool throws so Pi marks `isError: true`.
- **Bad cancellation:** wrapping Esc as `All providers failed` or continuing to public after abort violates the contract.

## 6. Tests Required

- Extension: exact tool name/schema, `StringEnum`, signal identity into core, package-root loading.
- HTTP: pre-abort, mid-body abort with observable reader cancellation, timeout with signal-ignoring fetch, body cap.
- Query: Chinese/plain preservation, literal locale tokens, invalid calendar dates, deterministic relative dates, relaxed constraints.
- Brave: key header only, no locale params, recency, ordinary web results only, HTTP/malformed/body-limit/result-cap cases.
- Public adapters: fixture success plus HTTP/challenge and locale assertions.
- Aggregate: one vote per engine, distinct ports, stable ties, empty, partial failure, soft return, wait for first non-empty, hard cap, straggler abort, caller abort.
- Orchestrator: Brave success/empty/error/timeout, no-key public, public empty/failure, whole budget, key redaction.
- Formatter: JSON round-trip, text/details byte caps, entry-atomic indexes.

Normal tests must be offline. Live public/Brave tests are opt-in.

## 7. Wrong vs Correct

### Wrong

```ts
try {
  return await braveSearch(query);
} catch (error) {
  return publicSearch(query); // also runs after Esc and can leak raw error/key text
}
```

```ts
const text = await response.text(); // unbounded decompressed body
return { details: { consensus: new Map() } }; // not JSON-safe
```

### Correct

```ts
try {
  return await raceWithAbort(braveSearch(request), combinedSignal);
} catch (error) {
  callerSignal?.throwIfAborted();
  if (wholeSignal.aborted) throw wholeSignal.reason;
  attempts.push(safeRedactedFailure(error));
  return publicSearch(request);
}
```

```ts
const text = await readBodyLimited(response, 2 * 1024 * 1024, signal);
return { details: { schemaVersion: 1, sources: jsonSafeSources } };
```

For isolated package validation, disable ambient extensions so another installed `web_search` cannot mask or conflict with this package:

```powershell
$pkg = (Resolve-Path .\packages\pi-web-search).Path
pi -ne -e $pkg --list-models
```
