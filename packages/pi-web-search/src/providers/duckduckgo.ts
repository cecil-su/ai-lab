/** Adapted from oh-my-pi's MIT-licensed DuckDuckGo provider at snapshot a7abeff1b7c0c94f9b63b11bd8b40d881f26a72f. */
import { fetchPage } from "../http.ts";
import { formatScraperQuery, type QuerySyntax } from "../query.ts";
import { SearchProviderError, type RawSearchSource, type Recency, type SearchRequest } from "../types.ts";
import { dedupeSources } from "../url.ts";
import { decodeHtml } from "./shared.ts";

const URL = "https://html.duckduckgo.com/html/";
const RECENCY: Record<Recency, string> = { day: "d", week: "w", month: "m", year: "y" };
const SYNTAX: QuerySyntax = {
	phrases: true,
	negation: true,
	or: true,
	site: true,
	inUrl: true,
	inTitle: true,
	inText: true,
	filetype: true,
};

function unwrap(href: string): string | undefined {
	const decoded = href.replace(/&amp;/gi, "&");
	const wrapped = decoded.match(/[?&]uddg=([^&]+)/);
	if (wrapped) {
		try {
			return decodeURIComponent(wrapped[1]);
		} catch {
			return undefined;
		}
	}
	if (decoded.startsWith("//")) return `https:${decoded}`;
	return /^https?:\/\//.test(decoded) ? decoded : undefined;
}

function parse(html: string): RawSearchSource[] {
	const out: RawSearchSource[] = [];
	const blockRe =
		/<div\b[^>]*\bclass="[^"]*\bresult\b[^"]*"[^>]*>([\s\S]*?)(?=<div\b[^>]*\bclass="[^"]*\bresult\b|<div\b[^>]*\bclass="[^"]*\bnav-link\b|$)/g;
	const titleRe = /<a\b[^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
	const snippetRe = /<(?:a|div|span)\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/;
	for (const match of html.matchAll(blockRe)) {
		const title = titleRe.exec(match[1]);
		if (!title) continue;
		const url = unwrap(title[1]);
		const text = decodeHtml(title[2]);
		if (!url || !text) continue;
		const foundSnippet = snippetRe.exec(match[1]);
		out.push({ title: text, url, snippet: foundSnippet ? decodeHtml(foundSnippet[1]) : undefined });
	}
	return out;
}

export async function searchDuckDuckGo(request: SearchRequest): Promise<RawSearchSource[]> {
	const form = new URLSearchParams({
		q: formatScraperQuery(request.query, request.parsedQuery, SYNTAX),
		b: "",
	});
	if (request.recency) form.set("df", RECENCY[request.recency]);
	const page = await fetchPage(URL, {
		fetch: request.fetch,
		signal: request.signal,
		timeoutMs: request.timeoutMs,
		scope: "DuckDuckGo search",
		init: {
			method: "POST",
			body: form.toString(),
			headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: URL },
		},
	});
	if (page.status < 200 || page.status >= 300) {
		throw new SearchProviderError("duckduckgo", `DuckDuckGo HTML request failed (${page.status})`, page.status);
	}
	if (page.text.includes("anomaly-modal") || page.text.includes("anomaly.js")) {
		throw new SearchProviderError("duckduckgo", "DuckDuckGo blocked the request with a bot challenge", 429);
	}
	return dedupeSources(parse(page.text), request.limit);
}
