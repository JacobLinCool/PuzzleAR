/**
 * Server-only bridge to Meta SAM 3.1. The Worker never parses masks: it
 * streams the provider's SSE body straight to the browser (which parses it with
 * @meta-sam/parser) and keeps a copy in R2 so retries of the same request are
 * served from cache instead of being billed again.
 */
import { Buffer } from 'node:buffer';
import type { RequestEvent } from '@sveltejs/kit';
import { apiError, env, sha256, waitUntil } from './http';
import type { SessionRow } from './session';

const META_URL = 'https://api.meta.ai/v1/responses';
export const IMAGE_COST_USD = 0.0025;
const IP_HOURLY_LIMIT = 60;

export interface SamJob {
	mediaId: string;
	kind: 'segment' | 'refine';
	/** Noun phrase or object-prompt text, already validated. */
	text: string;
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

async function guard(event: RequestEvent, row: SessionRow, ipHash: string): Promise<Response | null> {
	const e = env(event);
	if (!e.MODEL_API_KEY) {
		return apiError('SAM_UNAVAILABLE', 'The scanner is not configured on this server. You can still try the sample puzzle.', 503, {
			action: 'Try the sample'
		});
	}
	const hourAgo = Date.now() - 3600_000;
	const [bySession, byIp, running, usage] = await e.DB.batch([
		e.DB.prepare('SELECT COUNT(*) AS n FROM sam_requests WHERE session_id = ? AND created_at > ? AND status != ?').bind(row.id, hourAgo, 'failed'),
		e.DB.prepare('SELECT COUNT(*) AS n FROM sam_requests WHERE ip_hash = ? AND created_at > ?').bind(ipHash, hourAgo),
		e.DB.prepare('SELECT COUNT(*) AS n FROM sam_requests WHERE session_id = ? AND status = ? AND created_at > ?').bind(row.id, 'running', Date.now() - 90_000),
		e.DB.prepare('SELECT cost_usd FROM usage_daily WHERE day = ?').bind(today())
	]);
	const n = (r: D1Result) => Number((r.results[0] as { n?: number })?.n ?? 0);
	if (n(running) > 0) {
		return apiError('SAM_BUSY', 'A scan is already running for this puzzle.', 409, { retryable: true, action: 'Wait a moment' });
	}
	const limit = Number(e.SAM_SESSION_REQUEST_LIMIT || 15);
	if (n(bySession) >= limit) {
		return apiError('SAM_RATE_LIMITED', `This puzzle has used its ${limit} scans for the hour. Your work is saved.`, 429, {
			retryable: true,
			action: 'Retry later',
			headers: { 'retry-after': '600' }
		});
	}
	if (n(byIp) >= IP_HOURLY_LIMIT) {
		return apiError('SAM_RATE_LIMITED', 'The scanner is busy right now. Your work is saved.', 429, {
			retryable: true,
			action: 'Retry later',
			headers: { 'retry-after': '600' }
		});
	}
	const spent = Number((usage.results[0] as { cost_usd?: number })?.cost_usd ?? 0);
	if (spent + IMAGE_COST_USD > Number(e.META_DAILY_BUDGET_USD || 25)) {
		return apiError('SAM_BUDGET_EXCEEDED', 'Today’s scanning budget for this demo is used up. The sample puzzle still works.', 503, {
			retryable: true,
			action: 'Try the sample'
		});
	}
	return null;
}

function toBase64(bytes: ArrayBuffer): string {
	// nodejs_compat gives a native Buffer, far cheaper than btoa on large strings
	return Buffer.from(bytes).toString('base64');
}

async function callMeta(key: string, body: string): Promise<Response> {
	const delays = [500, 1000, 2000];
	for (let attempt = 0; ; attempt++) {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 60_000);
		let res: Response;
		try {
			res = await fetch(META_URL, {
				method: 'POST',
				headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
				body,
				signal: ctrl.signal
			});
		} finally {
			clearTimeout(timer);
		}
		if (res.status !== 429 || attempt >= delays.length) return res;
		const retryAfter = Number(res.headers.get('retry-after'));
		const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 4000) : delays[attempt];
		await res.body?.cancel();
		await new Promise((r) => setTimeout(r, wait + Math.random() * 200));
	}
}

export async function runSam(event: RequestEvent, row: SessionRow, job: SamJob): Promise<Response> {
	const e = env(event);
	const media = await e.DB.prepare('SELECT * FROM media WHERE id = ? AND session_id = ?')
		.bind(job.mediaId, row.id)
		.first<{ r2_key: string; mime: string }>();
	if (!media) return apiError('NOT_FOUND', 'That photo is not part of this session.', 404);

	const cacheKey = await sha256([job.mediaId, job.kind, job.text, 'one_bit'].join('|'));
	const cached = await e.DB.prepare(
		'SELECT id, r2_key, provider_request_id FROM sam_requests WHERE session_id = ? AND cache_key = ? AND status = ? ORDER BY created_at DESC LIMIT 1'
	)
		.bind(row.id, cacheKey, 'completed')
		.first<{ id: string; r2_key: string; provider_request_id: string | null }>();
	if (cached?.r2_key) {
		const obj = await e.BUCKET.get(cached.r2_key);
		if (obj) {
			return new Response(obj.body, {
				headers: {
					'content-type': 'text/event-stream',
					'cache-control': 'no-store',
					'x-puzzlear-request-id': cached.id,
					'x-provider-request-id': cached.provider_request_id ?? '',
					'x-puzzlear-cache': 'hit'
				}
			});
		}
	}

	const ip = event.request.headers.get('cf-connecting-ip') ?? event.getClientAddress?.() ?? 'unknown';
	const ipHash = (await sha256(`${today()}|${ip}`)).slice(0, 24);
	const blocked = await guard(event, row, ipHash);
	if (blocked) return blocked;

	const obj = await e.BUCKET.get(media.r2_key);
	if (!obj) return apiError('NOT_FOUND', 'The photo has expired.', 404);
	const dataUrl = `data:${media.mime};base64,${toBase64(await obj.arrayBuffer())}`;

	const id = crypto.randomUUID();
	const now = Date.now();
	await e.DB.batch([
		e.DB.prepare(
			`INSERT INTO sam_requests (id, session_id, media_id, kind, cache_key, status, ip_hash, cost_usd, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`
		).bind(id, row.id, job.mediaId, job.kind, cacheKey, ipHash, IMAGE_COST_USD, now, now),
		e.DB.prepare(
			`INSERT INTO usage_daily (day, requests, cost_usd) VALUES (?, 1, ?)
			 ON CONFLICT(day) DO UPDATE SET requests = requests + 1, cost_usd = cost_usd + excluded.cost_usd`
		).bind(today(), IMAGE_COST_USD)
	]);

	const fail = async (code: string) => {
		await e.DB.prepare('UPDATE sam_requests SET status = ?, error_code = ?, updated_at = ? WHERE id = ?')
			.bind('failed', code, Date.now(), id)
			.run();
	};

	let upstream: Response;
	try {
		upstream = await callMeta(
			e.MODEL_API_KEY,
			JSON.stringify({
				model: 'sam-3.1',
				input: [
					{
						type: 'message',
						role: 'user',
						content: [
							{ type: 'input_text', text: job.text },
							{ type: 'input_image', image_url: dataUrl }
						]
					}
				],
				stream: true,
				metadata: { mask_encoding: 'one_bit', include_confidence: 'true' }
			})
		);
	} catch {
		await fail('SAM_TIMEOUT');
		return apiError('SAM_TIMEOUT', 'The scanner took too long to answer.', 504, { retryable: true, action: 'Try again' });
	}
	const providerId = upstream.headers.get('x-request-id') ?? '';
	console.log(JSON.stringify({ event: 'sam_request', id, kind: job.kind, status: upstream.status, providerRequestId: providerId }));

	if (!upstream.ok || !upstream.body) {
		const detail = (await upstream.text().catch(() => '')).slice(0, 300);
		console.log(JSON.stringify({ event: 'sam_error', id, status: upstream.status, detail }));
		if (upstream.status === 429) {
			await fail('SAM_RATE_LIMITED');
			return apiError('SAM_RATE_LIMITED', 'The scanner is busy right now. Your work is saved.', 429, {
				retryable: true,
				action: 'Retry later',
				headers: { 'retry-after': upstream.headers.get('retry-after') ?? '30' }
			});
		}
		if (upstream.status === 400) {
			await fail('SAM_BAD_REQUEST');
			return apiError('SAM_BAD_REQUEST', 'The scanner could not use that request. Try a different box or point.', 400);
		}
		if ([401, 403, 404].includes(upstream.status)) {
			await fail('SAM_AUTH');
			return apiError('SAM_AUTH', 'The scanner is not set up correctly on this server.', 502, { action: 'Try the sample' });
		}
		await fail('SAM_UNAVAILABLE');
		return apiError('SAM_UNAVAILABLE', 'The scanner is unavailable right now. Your work is saved.', 502, {
			retryable: true,
			action: 'Try again'
		});
	}

	const [toClient, toStore] = upstream.body.tee();
	waitUntil(
		event,
		(async () => {
			const text = await new Response(toStore).text();
			const completed = text.includes('"response.completed"');
			const objects = (text.match(/<\|mask;/g) ?? []).length;
			const key = `sessions/${row.id}/sam/${id}.txt`;
			if (completed) await e.BUCKET.put(key, text, { httpMetadata: { contentType: 'text/event-stream' } });
			await e.DB.prepare(
				'UPDATE sam_requests SET status = ?, r2_key = ?, objects = ?, provider_request_id = ?, updated_at = ? WHERE id = ?'
			)
				.bind(completed ? 'completed' : 'failed', completed ? key : null, objects, providerId, Date.now(), id)
				.run();
			console.log(JSON.stringify({ event: 'sam_done', id, providerRequestId: providerId, completed, objects }));
		})().catch(() => fail('SAM_STREAM'))
	);

	return new Response(toClient, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store',
			'x-puzzlear-request-id': id,
			'x-provider-request-id': providerId,
			'x-puzzlear-cache': 'miss'
		}
	});
}
