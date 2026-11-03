import type { RequestEvent } from '@sveltejs/kit';
import { env as cfEnv, waitUntil as cfWaitUntil } from 'cloudflare:workers';

export type ErrorCode =
	| 'BAD_REQUEST'
	| 'NOT_FOUND'
	| 'SESSION_EXPIRED'
	| 'SESSION_CHANGED'
	| 'FORBIDDEN'
	| 'PAYLOAD_TOO_LARGE'
	| 'UNSUPPORTED_MEDIA'
	| 'INVALID_DOC'
	| 'NO_MASKS'
	| 'SAM_RATE_LIMITED'
	| 'SAM_BUDGET_EXCEEDED'
	| 'SAM_UNAVAILABLE'
	| 'SAM_BAD_REQUEST'
	| 'SAM_AUTH'
	| 'SAM_TIMEOUT'
	| 'SAM_BUSY'
	| 'INTERNAL';

export function requestId(): string {
	return crypto.randomUUID();
}

export function apiError(
	code: ErrorCode,
	message: string,
	status: number,
	opts: { retryable?: boolean; action?: string; headers?: Record<string, string> } = {}
): Response {
	return new Response(
		JSON.stringify({
			error: { code, message, retryable: opts.retryable ?? false, action: opts.action },
			requestId: requestId()
		}),
		{ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...opts.headers } }
	);
}

export function json(data: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(data), {
		...init,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...init.headers }
	});
}

/** Cloudflare bindings (D1, R2, vars, secrets) for the current request. */
export function env(_event?: RequestEvent): Env {
	return cfEnv as unknown as Env;
}

export function waitUntil(_event: RequestEvent, p: Promise<unknown>) {
	cfWaitUntil(p);
}

export async function sha256(text: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 24): string {
	const a = crypto.getRandomValues(new Uint8Array(bytes));
	return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
