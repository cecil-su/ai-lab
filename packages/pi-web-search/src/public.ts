/** Public aggregation adapted from oh-my-pi (MIT), snapshot a7abeff1b7c0c94f9b63b11bd8b40d881f26a72f. */
import { raceWithAbort, throwIfCallerAborted } from "./http.ts";
import { searchDuckDuckGo } from "./providers/duckduckgo.ts";
import { searchMojeek } from "./providers/mojeek.ts";
import { searchStartpage } from "./providers/startpage.ts";
import {
	SearchProviderError,
	SearchTimeoutError,
	safeDiagnostic,
	type EngineAttempt,
	type PublicEngineId,
	type RawSearchSource,
	type SearchRequest,
} from "./types.ts";
import { canonicalUrlKey } from "./url.ts";

export const PUBLIC_ENGINE_ORDER = ["startpage", "duckduckgo", "mojeek"] as const;

export interface RankedPublicSource extends RawSearchSource {
	engines: PublicEngineId[];
	engineCount: number;
}

export interface PublicSearchResult {
	sources: RankedPublicSource[];
	engineAttempts: EngineAttempt[];
}

export interface PublicDeadlines {
	softMs: number;
	hardMs: number;
	requestMs: number;
}

export type PublicEngineRunner = (request: SearchRequest) => Promise<RawSearchSource[]>;

const DEFAULT_RUNNERS: Record<PublicEngineId, PublicEngineRunner> = {
	startpage: searchStartpage,
	duckduckgo: searchDuckDuckGo,
	mojeek: searchMojeek,
};

const DEFAULT_DEADLINES: PublicDeadlines = { softMs: 5_000, hardMs: 20_000, requestMs: 15_000 };

function outcome(error: unknown): "timeout" | "error" {
	return error instanceof SearchTimeoutError ? "timeout" : "error";
}

function delay(ms: number): { promise: Promise<void>; cancel: () => void } {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const promise = new Promise<void>(resolve => {
		timer = setTimeout(resolve, Math.max(0, ms));
		timer.unref?.();
	});
	return { promise, cancel: () => timer && clearTimeout(timer) };
}

interface Merged {
	source: RawSearchSource;
	engines: Set<PublicEngineId>;
	bestRank: number;
	order: number;
}

export function mergePublicSources(
	responses: ReadonlyMap<PublicEngineId, readonly RawSearchSource[]>,
	limit: number,
): RankedPublicSource[] {
	const merged = new Map<string, Merged>();
	for (const engine of PUBLIC_ENGINE_ORDER) {
		const sources = responses.get(engine) ?? [];
		const seenInEngine = new Set<string>();
		for (const [rank, source] of sources.entries()) {
			const key = canonicalUrlKey(source.url);
			if (seenInEngine.has(key)) continue;
			seenInEngine.add(key);
			const existing = merged.get(key);
			if (!existing) {
				merged.set(key, { source: { ...source }, engines: new Set([engine]), bestRank: rank, order: merged.size });
				continue;
			}
			existing.engines.add(engine);
			if (rank < existing.bestRank) {
				existing.bestRank = rank;
				existing.source.title = source.title;
				existing.source.url = source.url;
			}
			if (source.snippet && source.snippet.length > (existing.source.snippet?.length ?? 0)) {
				existing.source.snippet = source.snippet;
			}
			existing.source.publishedDate ??= source.publishedDate;
			existing.source.ageSeconds ??= source.ageSeconds;
		}
	}
	return [...merged.values()]
		.sort((a, b) => b.engines.size - a.engines.size || a.bestRank - b.bestRank || a.order - b.order)
		.slice(0, limit)
		.map(item => ({ ...item.source, engines: [...item.engines], engineCount: item.engines.size }));
}

export async function searchPublic(
	request: SearchRequest,
	options: {
		deadlines?: Partial<PublicDeadlines>;
		runners?: Partial<Record<PublicEngineId, PublicEngineRunner>>;
	} = {},
): Promise<PublicSearchResult> {
	throwIfCallerAborted(request.signal);
	const deadlines = { ...DEFAULT_DEADLINES, ...options.deadlines };
	const runners = { ...DEFAULT_RUNNERS, ...options.runners };
	const stragglers = new AbortController();
	const signal = request.signal ? AbortSignal.any([request.signal, stragglers.signal]) : stragglers.signal;
	const responses = new Map<PublicEngineId, RawSearchSource[]>();
	const attempts = new Map<PublicEngineId, EngineAttempt>();
	const firstNonEmpty = Promise.withResolvers<void>();
	const aggregateStarted = Date.now();
	let settled = false;

	const all = Promise.all(
		PUBLIC_ENGINE_ORDER.map(async engine => {
			const started = Date.now();
			try {
				const sources = await runners[engine]({
					...request,
					signal,
					timeoutMs: Math.max(1, Math.min(request.timeoutMs, deadlines.requestMs)),
				});
				if (attempts.has(engine)) return;
				responses.set(engine, sources);
				attempts.set(engine, {
					engine,
					outcome: sources.length > 0 ? "success" : "empty",
					resultCount: sources.length,
					durationMs: Date.now() - started,
				});
				if (sources.length > 0) firstNonEmpty.resolve();
			} catch (error) {
				if (request.signal?.aborted) throw request.signal.reason;
				if (stragglers.signal.aborted || attempts.has(engine)) return;
				attempts.set(engine, {
					engine,
					outcome: outcome(error),
					resultCount: 0,
					durationMs: Date.now() - started,
					error: safeDiagnostic(error),
				});
			}
		}),
	).finally(() => {
		settled = true;
	});

	const soft = delay(Math.min(deadlines.softMs, deadlines.hardMs));
	const hard = delay(deadlines.hardMs);
	try {
		const wait = <T>(promise: Promise<T>): Promise<T> => request.signal ? raceWithAbort(promise, request.signal) : promise;
		await wait(Promise.race([all, soft.promise]));
		throwIfCallerAborted(request.signal);
		if (![...responses.values()].some(items => items.length > 0) && !settled) {
			await wait(Promise.race([all, firstNonEmpty.promise, hard.promise]));
		}
		throwIfCallerAborted(request.signal);
		if (!settled) {
			for (const engine of PUBLIC_ENGINE_ORDER) {
				if (!attempts.has(engine)) {
					attempts.set(engine, {
						engine,
						outcome: "timeout",
						resultCount: 0,
						durationMs: Date.now() - aggregateStarted,
						error: "Stopped after the public aggregate deadline",
					});
				}
			}
		}
	} finally {
		soft.cancel();
		hard.cancel();
		stragglers.abort(new DOMException("Public search completed", "AbortError"));
	}

	const engineAttempts = PUBLIC_ENGINE_ORDER.map(engine => attempts.get(engine)).filter(
		(attempt): attempt is EngineAttempt => attempt !== undefined,
	);
	const sources = mergePublicSources(responses, request.limit);
	if (sources.length === 0 && engineAttempts.every(attempt => attempt.outcome === "error" || attempt.outcome === "timeout")) {
		throw new SearchProviderError(
			"public",
			`All public engines failed: ${engineAttempts.map(item => `${item.engine}: ${item.error ?? item.outcome}`).join("; ")}`,
			503,
		);
	}
	return { sources, engineAttempts };
}
