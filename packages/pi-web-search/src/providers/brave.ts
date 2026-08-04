/** Adapted from oh-my-pi's MIT-licensed Brave provider at snapshot a7abeff1b7c0c94f9b63b11bd8b40d881f26a72f. */
import { fetchPage, throwIfCallerAborted } from "../http.ts";
import { formatQuery, GOOGLE_QUERY_SYNTAX, type QuerySyntax, type StructuredQuery } from "../query.ts";
import {
	SearchProviderError,
	type RawSearchSource,
	type Recency,
	type SearchRequest,
	normalizeRawSource,
} from "../types.ts";
import { dedupeSources } from "../url.ts";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const RECENCY_MAP: Record<Recency, "pd" | "pw" | "pm" | "py"> = {
	day: "pd",
	week: "pw",
	month: "pm",
	year: "py",
};
const BRAVE_QUERY_SYNTAX: QuerySyntax = { ...GOOGLE_QUERY_SYNTAX, dateRange: false };

interface BraveResult {
	title?: string | null;
	url?: string | null;
	description?: string | null;
	age?: string | null;
	extra_snippets?: string[] | null;
}
interface BravePayload {
	web?: { results?: BraveResult[] };
}

function freshness(parsed: StructuredQuery, recency?: Recency): string | undefined {
	if (parsed.after || parsed.before) {
		return `${parsed.after ?? "1970-01-01"}to${parsed.before ?? new Date().toISOString().slice(0, 10)}`;
	}
	return recency ? RECENCY_MAP[recency] : undefined;
}

function snippet(result: BraveResult): string | undefined {
	const values = [result.description, ...(result.extra_snippets ?? [])]
		.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
		.map(value => value.trim());
	return [...new Set(values)].join("\n") || undefined;
}

export async function searchBrave(request: SearchRequest, apiKey: string): Promise<RawSearchSource[]> {
	throwIfCallerAborted(request.signal);
	const url = new URL(BRAVE_SEARCH_URL);
	url.searchParams.set(
		"q",
		request.parsedQuery.hasDirectives
			? formatQuery(request.parsedQuery, BRAVE_QUERY_SYNTAX)
			: request.query,
	);
	url.searchParams.set("count", String(request.limit));
	url.searchParams.set("extra_snippets", "true");
	const mappedFreshness = freshness(request.parsedQuery, request.recency);
	if (mappedFreshness) url.searchParams.set("freshness", mappedFreshness);

	const page = await fetchPage(url.href, {
		fetch: request.fetch,
		signal: request.signal,
		timeoutMs: request.timeoutMs,
		scope: "Brave search",
		init: {
			headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
		},
	});
	if (page.status < 200 || page.status >= 300) {
		throw new SearchProviderError("brave", `Brave API request failed (${page.status})`, page.status);
	}

	let payload: BravePayload;
	try {
		payload = JSON.parse(page.text) as BravePayload;
	} catch {
		throw new SearchProviderError("brave", "Brave API returned malformed JSON");
	}
	const sources: RawSearchSource[] = [];
	for (const result of payload.web?.results ?? []) {
		if (!result.url) continue;
		const normalized = normalizeRawSource({
			title: result.title ?? result.url,
			url: result.url,
			snippet: snippet(result),
			publishedDate: result.age ?? undefined,
		});
		if (normalized) sources.push(normalized);
	}
	return dedupeSources(sources, request.limit);
}
