import { resolveConfig, type WebSearchConfig } from "./config.ts";
import { formatWebSearchResult, type RankedSource } from "./format.ts";
import { raceWithAbort, throwIfCallerAborted } from "./http.ts";
import { searchBrave } from "./providers/brave.ts";
import { searchPublic, type PublicSearchResult } from "./public.ts";
import { applyQueryConstraints, parseSearchQuery } from "./query.ts";
import {
	MAX_QUERY_CHARS,
	SearchTimeoutError,
	clampLimit,
	safeDiagnostic,
	type ProviderAttempt,
	type RawSearchSource,
	type SearchRequest,
	type WebSearchInput,
	type WebSearchResult,
} from "./types.ts";

export interface SearchTimings {
	wholeMs: number;
	braveMs: number;
	publicSoftMs: number;
	publicHardMs: number;
	publicRequestMs: number;
}

const DEFAULT_TIMINGS: SearchTimings = {
	wholeMs: 30_000,
	braveMs: 10_000,
	publicSoftMs: 5_000,
	publicHardMs: 20_000,
	publicRequestMs: 15_000,
};

export interface SearchDependencies {
	fetch?: typeof fetch;
	env?: NodeJS.ProcessEnv;
	config?: WebSearchConfig;
	timings?: Partial<SearchTimings>;
	brave?: (request: SearchRequest, apiKey: string) => Promise<RawSearchSource[]>;
	public?: (request: SearchRequest, timings: SearchTimings) => Promise<PublicSearchResult>;
	now?: () => number;
}

function classify(error: unknown): "timeout" | "error" {
	return error instanceof SearchTimeoutError ? "timeout" : "error";
}

function diagnostic(error: unknown, secrets: readonly (string | undefined)[] = []): string {
	let message = safeDiagnostic(error);
	for (const secret of secrets) {
		if (secret) message = message.split(secret).join("[REDACTED]");
	}
	return message;
}

function rankedBrave(sources: RawSearchSource[]): RankedSource[] {
	return sources.map(source => ({ ...source, engines: ["brave"], engineCount: 1 }));
}

export async function executeWebSearch(
	input: WebSearchInput,
	signal?: AbortSignal,
	dependencies: SearchDependencies = {},
): Promise<WebSearchResult> {
	throwIfCallerAborted(signal);
	const query = input.query?.trim();
	if (!query) throw new Error("Search query is required.");
	if (query.length > MAX_QUERY_CHARS) throw new Error(`Search query must be at most ${MAX_QUERY_CHARS} characters.`);
	const limit = clampLimit(input.limit);
	const config = dependencies.config ?? resolveConfig(dependencies.env);
	const timings = { ...DEFAULT_TIMINGS, ...dependencies.timings };
	const now = dependencies.now ?? Date.now;
	const started = now();
	const whole = new AbortController();
	const timer = setTimeout(() => whole.abort(new SearchTimeoutError("Web search")), Math.max(1, timings.wholeMs));
	timer.unref?.();
	const combined = signal ? AbortSignal.any([signal, whole.signal]) : whole.signal;
	const parsedQuery = parseSearchQuery(query);
	const attempts: ProviderAttempt[] = [];
	let engineAttempts: PublicSearchResult["engineAttempts"] = [];
	let provider: "brave" | "public" = "public";
	let sources: RankedSource[] = [];

	const remaining = (): number => Math.max(1, timings.wholeMs - (now() - started));
	const request = (timeoutMs: number): SearchRequest => ({
		query,
		parsedQuery,
		limit,
		recency: input.recency,
		signal: combined,
		fetch: dependencies.fetch ?? fetch,
		timeoutMs: Math.max(1, Math.min(timeoutMs, remaining())),
	});

	try {
		if (config.mode === "auto" && config.braveApiKey) {
			const attemptStarted = now();
			try {
				const found = await raceWithAbort(
					(dependencies.brave ?? searchBrave)(request(timings.braveMs), config.braveApiKey),
					combined,
				);
				throwIfCallerAborted(signal);
				if (whole.signal.aborted) throw whole.signal.reason;
				attempts.push({
					provider: "brave",
					outcome: found.length > 0 ? "success" : "empty",
					resultCount: found.length,
					durationMs: now() - attemptStarted,
				});
				if (found.length > 0) {
					provider = "brave";
					sources = rankedBrave(found);
				}
			} catch (error) {
				throwIfCallerAborted(signal);
				if (whole.signal.aborted) throw whole.signal.reason;
				attempts.push({
					provider: "brave",
					outcome: classify(error),
					resultCount: 0,
					durationMs: now() - attemptStarted,
					error: diagnostic(error, [config.braveApiKey]),
				});
			}
		}

		if (sources.length === 0) {
			const attemptStarted = now();
			try {
				const publicResult = await raceWithAbort(
					(dependencies.public ?? ((req, values) => searchPublic(req, {
						deadlines: {
							softMs: Math.min(values.publicSoftMs, remaining()),
							hardMs: Math.min(values.publicHardMs, remaining()),
							requestMs: Math.min(values.publicRequestMs, remaining()),
						},
					})))(request(Math.min(timings.publicRequestMs, remaining())), timings),
					combined,
				);
				throwIfCallerAborted(signal);
				if (whole.signal.aborted) throw whole.signal.reason;
				provider = "public";
				sources = publicResult.sources;
				engineAttempts = publicResult.engineAttempts;
				attempts.push({
					provider: "public",
					outcome: sources.length > 0 ? "success" : "empty",
					resultCount: sources.length,
					durationMs: now() - attemptStarted,
				});
			} catch (error) {
				throwIfCallerAborted(signal);
				if (whole.signal.aborted) throw whole.signal.reason;
				attempts.push({
					provider: "public",
					outcome: classify(error),
					resultCount: 0,
					durationMs: now() - attemptStarted,
					error: diagnostic(error),
				});
				if (!attempts.some(attempt => attempt.outcome === "empty")) {
					throw new Error(`Web search unavailable: ${attempts.map(item => `${item.provider}: ${item.error ?? item.outcome}`).join("; ")}`);
				}
			}
		}

		const filtered = parsedQuery.hasConstraints
			? applyQueryConstraints(sources, parsedQuery, now())
			: { sources, dropped: [] };
		return formatWebSearchResult({
			mode: config.mode,
			provider,
			sources: filtered.sources as RankedSource[],
			attempts,
			engineAttempts,
			relaxedConstraints: filtered.dropped,
			elapsedMs: now() - started,
		});
	} finally {
		clearTimeout(timer);
	}
}
