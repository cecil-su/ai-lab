import type { SearchMode } from "./types.ts";

export interface WebSearchConfig {
	mode: SearchMode;
	braveApiKey?: string;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): WebSearchConfig {
	const rawMode = env.PI_WEB_SEARCH_MODE?.trim().toLowerCase() || "auto";
	if (rawMode !== "auto" && rawMode !== "public") {
		throw new Error('PI_WEB_SEARCH_MODE must be "auto" or "public".');
	}
	const key = env.BRAVE_API_KEY?.trim();
	return { mode: rawMode, ...(key ? { braveApiKey: key } : {}) };
}
