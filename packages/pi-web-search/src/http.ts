import { MAX_RESPONSE_BYTES, SearchTimeoutError } from "./types.ts";

export interface FetchPageOptions {
	fetch?: typeof fetch;
	signal?: AbortSignal;
	timeoutMs: number;
	init?: RequestInit;
	maxBytes?: number;
	scope: string;
}

export interface LoadedPage {
	status: number;
	url: string;
	headers: Headers;
	text: string;
}

const BROWSER_HEADERS: Record<string, string> = {
	Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
	"Cache-Control": "no-cache",
	"User-Agent":
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
};

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

export function throwIfCallerAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortReason(signal);
}

export function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(abortReason(signal));
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(abortReason(signal));
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
	});
}

async function readBodyLimited(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		await response.body?.cancel().catch(() => undefined);
		throw new Error(`Search response exceeded ${maxBytes} bytes`);
	}
	if (!response.body) return "";

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let text = "";
	try {
		while (true) {
			const chunk = await raceWithAbort(reader.read(), signal);
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new Error(`Search response exceeded ${maxBytes} bytes`);
			}
			text += decoder.decode(chunk.value, { stream: true });
		}
		text += decoder.decode();
		return text;
	} catch (error) {
		await reader.cancel(error).catch(() => undefined);
		throw error;
	} finally {
		reader.releaseLock();
	}
}

export async function fetchPage(url: string, options: FetchPageOptions): Promise<LoadedPage> {
	throwIfCallerAborted(options.signal);
	const timeout = new AbortController();
	const timer = setTimeout(() => timeout.abort(new SearchTimeoutError(options.scope)), Math.max(1, options.timeoutMs));
	timer.unref?.();
	const combined = options.signal
		? AbortSignal.any([options.signal, timeout.signal])
		: timeout.signal;
	const fetchImpl = options.fetch ?? fetch;
	try {
		const response = await raceWithAbort(
			fetchImpl(url, {
				...options.init,
				headers: { ...BROWSER_HEADERS, ...Object.fromEntries(new Headers(options.init?.headers).entries()) },
				signal: combined,
				redirect: "follow",
			}),
			combined,
		);
		const text = await readBodyLimited(response, options.maxBytes ?? MAX_RESPONSE_BYTES, combined);
		throwIfCallerAborted(options.signal);
		return { status: response.status, url: response.url || url, headers: response.headers, text };
	} catch (error) {
		throwIfCallerAborted(options.signal);
		if (timeout.signal.aborted) throw timeout.signal.reason;
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

export async function fetchJson<T>(url: string, options: FetchPageOptions): Promise<{ data: T; page: LoadedPage }> {
	const page = await fetchPage(url, options);
	let data: T;
	try {
		data = JSON.parse(page.text) as T;
	} catch {
		throw new Error(`${options.scope} returned malformed JSON`);
	}
	return { data, page };
}
