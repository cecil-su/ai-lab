/** Adapted from oh-my-pi's MIT-licensed Mojeek provider at snapshot a7abeff1b7c0c94f9b63b11bd8b40d881f26a72f. */
import { fetchPage } from "../http.ts";
import { formatScraperQuery, type QuerySyntax } from "../query.ts";
import { SearchProviderError, type RawSearchSource, type SearchRequest } from "../types.ts";
import { dedupeSources } from "../url.ts";
import { decodeHtml } from "./shared.ts";

const ORIGIN = "https://www.mojeek.com";
const HOME_URL = `${ORIGIN}/`;
const SEARCH_URL = `${ORIGIN}/search`;
const SYNTAX: QuerySyntax = { phrases: true, negation: true, site: true };

function parse(html: string): RawSearchSource[] {
	const out: RawSearchSource[] = [];
	const list = /<ul\b[^>]*\bclass="[^"]*\bresults-standard\b[^"]*"[^>]*>([\s\S]*?)<\/ul>/i.exec(html);
	const scope = list ? list[1] : html;
	const anchorRe =
		/<a\b[^>]*\bclass="[^"]*\btitle\b[^"]*"[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,800}?)(?=<a\b[^>]*\bclass="[^"]*\btitle\b|$)/g;
	for (const match of scope.matchAll(anchorRe)) {
		let url: URL;
		try {
			url = new URL(match[1].replace(/&amp;/gi, "&"), HOME_URL);
		} catch {
			continue;
		}
		if (!/^https?:$/.test(url.protocol) || /(^|\.)mojeek\.(com|co\.uk|fr|de)$/.test(url.hostname)) continue;
		const title = decodeHtml(match[2]);
		if (!title) continue;
		const snippet = /<p\b[^>]*\bclass="[^"]*\bs\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(match[3]);
		out.push({ title, url: url.href, snippet: snippet ? decodeHtml(snippet[1]) : undefined });
	}
	return out;
}

export async function searchMojeek(request: SearchRequest): Promise<RawSearchSource[]> {
	const url = new URL(SEARCH_URL);
	url.searchParams.set("q", formatScraperQuery(request.query, request.parsedQuery, SYNTAX));
	url.searchParams.set("t", String(request.limit));
	url.searchParams.set("arc", "none");
	if (request.recency) url.searchParams.set("since", request.recency);
	const page = await fetchPage(url.href, {
		fetch: request.fetch,
		signal: request.signal,
		timeoutMs: request.timeoutMs,
		scope: "Mojeek search",
		init: { headers: { Referer: HOME_URL } },
	});
	if (page.status < 200 || page.status >= 300) {
		throw new SearchProviderError("mojeek", `Mojeek HTML request failed (${page.status})`, page.status);
	}
	if (
		(page.text.includes("altcha-widget") || page.text.includes("captcha-wrap") || /sending automated queries/i.test(page.text)) &&
		!page.text.includes("results-standard")
	) {
		throw new SearchProviderError("mojeek", "Mojeek blocked the request with a bot challenge", 429);
	}
	return dedupeSources(parse(page.text), request.limit);
}
