import type { RequestHandler } from './$types';
import { MAX_DOC_BYTES, validateDoc, type WorkspaceDoc } from '$lib/shared/doc';
import { apiError, env, json } from '$lib/server/http';
import { authorize, cookieName, destroySession, parseDoc } from '$lib/server/session';

export const GET: RequestHandler = async (event) => {
	const row = await authorize(event, event.params.id);
	if (row instanceof Response) return row;
	return json({
		id: row.id,
		mode: row.mode,
		state: row.state,
		revision: row.revision,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		scannerAvailable: Boolean(env(event).MODEL_API_KEY),
		doc: parseDoc(row)
	});
};

/** Stores a new document version. Requires the current revision (optimistic concurrency). */
export const PUT: RequestHandler = async (event) => {
	const row = await authorize(event, event.params.id);
	if (row instanceof Response) return row;
	const text = await event.request.text();
	if (text.length > MAX_DOC_BYTES) return apiError('PAYLOAD_TOO_LARGE', 'This puzzle has grown too large to save.', 413);
	let body: { revision: number; doc: WorkspaceDoc; history?: 'undo' | 'redo' };
	try {
		body = JSON.parse(text);
	} catch {
		return apiError('BAD_REQUEST', 'Invalid JSON', 400);
	}
	if (body.revision !== row.revision) {
		return apiError('SESSION_CHANGED', 'This puzzle changed in another tab. We reloaded the latest version.', 409, {
			retryable: true
		});
	}
	const prev = parseDoc(row);
	const problem = validateDoc(prev, body.doc, { allowAnyTransition: Boolean(body.history) });
	if (problem) return apiError('INVALID_DOC', problem, 422);
	if (body.doc.photo && body.doc.photo.source !== 'sample') {
		const media = await env(event)
			.DB.prepare('SELECT id FROM media WHERE id = ? AND session_id = ?')
			.bind(body.doc.photo.mediaId, row.id)
			.first();
		if (!media) return apiError('INVALID_DOC', 'Unknown photo', 422);
	}
	const next = row.revision + 1;
	const res = await env(event)
		.DB.prepare('UPDATE sessions SET doc = ?, state = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?')
		.bind(JSON.stringify(body.doc), body.doc.state, next, Date.now(), row.id, row.revision)
		.run();
	if (!res.meta.changes) {
		return apiError('SESSION_CHANGED', 'This puzzle changed in another tab. We reloaded the latest version.', 409, {
			retryable: true
		});
	}
	return json({ revision: next, state: body.doc.state });
};

export const DELETE: RequestHandler = async (event) => {
	const row = await authorize(event, event.params.id);
	if (row instanceof Response) return row;
	await destroySession(env(event), row.id);
	event.cookies.delete(cookieName(row.id), { path: '/' });
	return json({ deleted: true });
};
