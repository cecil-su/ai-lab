export type Recency = "day" | "week" | "month" | "year";
export type SearchMode = "auto" | "public";
export type ProviderId = "brave" | "public";
export type PublicEngineId = "startpage" | "duckduckgo" | "mojeek";
export type EngineId = "brave" | PublicEngineId;
export type AttemptOutcome = "success" | "empty" | "error" | "timeout";

export interface RawSearchSource {
	title: string;
	url: string;
	snippet?: string;
	publishedDate?: string;
	ageSeconds?: number;
}

export interface SearchSource extends RawSearchSource {
	index: number;
	engineCount: number;
	engines: EngineId[];
}

export interface SearchResponse {
	provider: EngineId | "public";
	sources: RawSearchSource[];
}

export interface SearchRequest {
	query: string;
	parsedQuery: import("./query.ts").StructuredQuery;
	limit: number;
	recency?: Recency;
	signal?: AbortSignal;
	fetch: typeof fetch;
	timeoutMs: number;
}

export interface ProviderAttempt {
	provider: ProviderId;
	outcome: AttemptOutcome;
	resultCount: number;
	durationMs: number;
	error?: string;
}

export interface EngineAttempt {
	engine: PublicEngineId;
	outcome: AttemptOutcome;
	resultCount: number;
	durationMs: number;
	error?: string;
}

export interface WebSearchDetails {
	schemaVersion: 1;
	mode: SearchMode;
	provider: ProviderId;
	sources: SearchSource[];
	attempts: ProviderAttempt[];
	engineAttempts: EngineAttempt[];
	relaxedConstraints: string[];
	elapsedMs: number;
	truncated: boolean;
}

export interface WebSearchInput {
	query: string;
	limit?: number;
	recency?: Recency;
}

export interface WebSearchResult {
	content: Array<{ type: "text"; text: string }>;
	details: WebSearchDetails;
}

export class SearchProviderError extends Error {
	constructor(
		public readonly provider: EngineId | "public",
		message: string,
		public readonly status?: number,
	) {
		super(message);
		this.name = "SearchProviderError";
	}
}

export class SearchTimeoutError extends Error {
	constructor(public readonly scope: string) {
		super(`${scope} timed out`);
		this.name = "SearchTimeoutError";
	}
}

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 20;
export const MAX_QUERY_CHARS = 2_000;
export const MAX_TITLE_CHARS = 200;
export const MAX_SNIPPET_CHARS = 240;
export const MAX_DATE_CHARS = 80;
export const MAX_URL_CHARS = 2_048;
export const MAX_DIAGNOSTIC_CHARS = 240;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_TEXT_BYTES = 24 * 1024;
export const MAX_DETAILS_BYTES = 32 * 1024;

export function clampLimit(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT;
	return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(value)));
}

export function cleanText(value: unknown, maxChars: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
	if (!cleaned) return undefined;
	return cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function safeDiagnostic(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return cleanText(message, MAX_DIAGNOSTIC_CHARS) ?? "Unknown search error";
}

export function normalizeHttpUrl(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length > MAX_URL_CHARS) return undefined;
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		return url.href;
	} catch {
		return undefined;
	}
}

export function normalizeRawSource(source: RawSearchSource): RawSearchSource | undefined {
	const url = normalizeHttpUrl(source.url);
	if (!url) return undefined;
	const title = cleanText(source.title, MAX_TITLE_CHARS) ?? url;
	const snippet = cleanText(source.snippet, MAX_SNIPPET_CHARS);
	const publishedDate = cleanText(source.publishedDate, MAX_DATE_CHARS);
	return {
		title,
		url,
		...(snippet ? { snippet } : {}),
		...(publishedDate ? { publishedDate } : {}),
		...(typeof source.ageSeconds === "number" && Number.isFinite(source.ageSeconds)
			? { ageSeconds: Math.max(0, source.ageSeconds) }
			: {}),
	};
}
