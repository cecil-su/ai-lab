import { normalizeRawSource, type RawSearchSource } from "./types.ts";

export function canonicalUrlKey(rawUrl: string): string {
	try {
		const url = new URL(rawUrl);
		const host = url.host.toLowerCase().replace(/^www\./, "");
		let path = url.pathname;
		if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
		return `${host}${path}${url.search}`;
	} catch {
		return rawUrl;
	}
}

export function dedupeSources(sources: readonly RawSearchSource[], limit: number): RawSearchSource[] {
	const out: RawSearchSource[] = [];
	const seen = new Set<string>();
	for (const input of sources) {
		const source = normalizeRawSource(input);
		if (!source) continue;
		const key = canonicalUrlKey(source.url);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(source);
		if (out.length >= limit) break;
	}
	return out;
}
