/** Adapted from oh-my-pi's MIT-licensed Startpage provider at snapshot a7abeff1b7c0c94f9b63b11bd8b40d881f26a72f. */
import { fetchPage, type LoadedPage } from "../http.ts";
import { formatScraperQuery } from "../query.ts";
import { SearchProviderError, type RawSearchSource, type Recency, type SearchRequest } from "../types.ts";
import { dedupeSources } from "../url.ts";
import { decodeHtml } from "./shared.ts";

const HOME_URL = "https://www.startpage.com/";
const SEARCH_URL = "https://www.startpage.com/sp/search";
const RECENCY: Record<Recency, string> = { day: "d", week: "w", month: "m", year: "y" };

function parseFormInputs(html: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const match of html.matchAll(/<input\b[^>]*\bname="([^"]+)"[^>]*\bvalue="([^"]*)"[^>]*>/gi)) {
		out[decodeHtml(match[1])] = decodeHtml(match[2]);
	}
	return out;
}

function resultUrl(href: string): string | undefined {
	try {
		const url = new URL(href.replace(/&amp;/gi, "&"), HOME_URL);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		if (url.hostname === "startpage.com" || url.hostname.endsWith(".startpage.com")) return undefined;
		return url.href;
	} catch {
		return undefined;
	}
}

function parse(html: string): RawSearchSource[] {
	const out: RawSearchSource[] = [];
	const anchorRe =
		/<a\b[^>]*\bclass="[^"]*\bresult-link\b[^"]*"[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,700}?)(?=<a\b[^>]*\bclass="[^"]*\bresult-link\b|$)/gi;
	for (const match of html.matchAll(anchorRe)) {
		const url = resultUrl(match[1]);
		if (!url) continue;
		const heading = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/i.exec(match[2]);
		const title = decodeHtml(heading?.[1] ?? match[2]);
		if (!title) continue;
		const snippet = /<p\b[^>]*\bclass="[^"]*\bdescription\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(match[3]);
		out.push({ title, url, snippet: snippet ? decodeHtml(snippet[1]) : undefined });
	}
	return out;
}

function isChallenge(status: number, html: string): boolean {
	return status === 403 || status === 429 || /captcha|robot check|unusual traffic|blocked/i.test(html);
}

export async function searchStartpage(request: SearchRequest): Promise<RawSearchSource[]> {
	const query = formatScraperQuery(request.query, request.parsedQuery);
	let inputs: Record<string, string> = {};
	try {
		const home = await fetchPage(HOME_URL, {
			fetch: request.fetch,
			signal: request.signal,
			timeoutMs: request.timeoutMs,
			scope: "Startpage home",
		});
		if (home.status >= 200 && home.status < 300 && !isChallenge(home.status, home.text)) {
			inputs = parseFormInputs(home.text);
		}
	} catch (error) {
		if (request.signal?.aborted) throw request.signal.reason;
		// The search endpoint also supports a tokenless GET fallback.
	}

	let page: LoadedPage;
	if (Object.keys(inputs).length > 0) {
		const form = new URLSearchParams(inputs);
		form.set("query", query);
		if (request.recency) form.set("with_date", RECENCY[request.recency]);
		page = await fetchPage(SEARCH_URL, {
			fetch: request.fetch,
			signal: request.signal,
			timeoutMs: request.timeoutMs,
			scope: "Startpage search",
			init: {
				method: "POST",
				body: form.toString(),
				headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: HOME_URL },
			},
		});
	} else {
		const url = new URL(SEARCH_URL);
		url.searchParams.set("query", query);
		if (request.recency) url.searchParams.set("with_date", RECENCY[request.recency]);
		page = await fetchPage(url.href, {
			fetch: request.fetch,
			signal: request.signal,
			timeoutMs: request.timeoutMs,
			scope: "Startpage search",
			init: { headers: { Referer: HOME_URL } },
		});
	}
	if (isChallenge(page.status, page.text)) {
		throw new SearchProviderError("startpage", "Startpage blocked the request with a bot challenge", 429);
	}
	if (page.status < 200 || page.status >= 300) {
		throw new SearchProviderError("startpage", `Startpage HTML request failed (${page.status})`, page.status);
	}
	return dedupeSources(parse(page.text), request.limit);
}
