import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { emptyDoc, type SessionMode, type WorkspaceDoc } from '$lib/shared/doc';
import { apiError, env, randomToken, sha256, waitUntil } from './http';

export interface SessionRow {
	id: string;
	secret_hash: string;
	mode: SessionMode;
	state: string;
	revision: number;
	doc: string;
	created_at: number;
	updated_at: number;
	expires_at: number;
}

export const cookieName = (id: string) => `pz_${id}`;

function retentionMs(e: Env): number {
	return Number(e.SESSION_RETENTION_HOURS || 24) * 3600_000;
}

export async function createSession(event: RequestEvent, mode: SessionMode) {
	const e = env(event);
	const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
	const secret = randomToken();
	const now = Date.now();
	const doc = emptyDoc(mode);
	await e.DB.prepare(
		`INSERT INTO sessions (id, secret_hash, mode, state, revision, doc, created_at, updated_at, expires_at)
		 VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`
	)
		.bind(id, await sha256(secret), mode, doc.state, JSON.stringify(doc), now, now, now + retentionMs(e))
		.run();
	setSessionCookie(event.cookies, event.url, id, secret, retentionMs(e));
	return { id, state: doc.state, createdAt: now, revision: 0, doc };
}

function setSessionCookie(cookies: Cookies, url: URL, id: string, secret: string, maxAgeMs: number) {
	cookies.set(cookieName(id), secret, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: Math.floor(maxAgeMs / 1000)
	});
}

/** Loads a session the caller holds the secret for, or returns an error response. */
export async function authorize(event: RequestEvent, id: string): Promise<SessionRow | Response> {
	if (!/^[a-f0-9]{20}$/.test(id)) return apiError('NOT_FOUND', 'This session does not exist.', 404);
	const secret = event.cookies.get(cookieName(id));
	const row = await env(event).DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<SessionRow>();
	if (!row || row.expires_at < Date.now()) {
		// retention: expired sessions are removed the first time anyone touches them
		if (row) waitUntil(event, destroySession(env(event), row.id).catch(() => {}));
		return apiError('SESSION_EXPIRED', 'This session has expired or was deleted.', 404, {
			action: 'Start a new puzzle'
		});
	}
	if (!secret || (await sha256(secret)) !== row.secret_hash) {
		return apiError('FORBIDDEN', 'This session belongs to another browser.', 403, {
			action: 'Start a new puzzle'
		});
	}
	return row;
}

export function parseDoc(row: SessionRow): WorkspaceDoc {
	return JSON.parse(row.doc) as WorkspaceDoc;
}

/** Deletes everything a session owns: R2 objects, then rows (media and requests cascade). */
export async function destroySession(e: Env, id: string) {
	let cursor: string | undefined;
	do {
		const list = await e.BUCKET.list({ prefix: `sessions/${id}/`, cursor });
		if (list.objects.length) await e.BUCKET.delete(list.objects.map((o) => o.key));
		cursor = list.truncated ? list.cursor : undefined;
	} while (cursor);
	await e.DB.batch([
		e.DB.prepare('DELETE FROM media WHERE session_id = ?').bind(id),
		e.DB.prepare('DELETE FROM sam_requests WHERE session_id = ?').bind(id),
		e.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id)
	]);
}

/**
 * Deletes a few expired sessions. Called opportunistically when sessions are
 * created; R2's lifecycle rule ("retention-24h") also expires photos after a day.
 */
export async function purgeExpired(e: Env, limit = 50): Promise<number> {
	const { results } = await e.DB.prepare('SELECT id FROM sessions WHERE expires_at < ? LIMIT ?')
		.bind(Date.now(), limit)
		.all<{ id: string }>();
	for (const r of results) await destroySession(e, r.id);
	return results.length;
}
