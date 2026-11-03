import type { RequestHandler } from './$types';
import { apiError, env } from '$lib/server/http';
import { authorize } from '$lib/server/session';

/** Photos are private: served only to the browser holding the session cookie. */
export const GET: RequestHandler = async (event) => {
	const row = await authorize(event, event.params.id);
	if (row instanceof Response) return row;
	const e = env(event);
	const media = await e.DB.prepare('SELECT r2_key, mime FROM media WHERE id = ? AND session_id = ?')
		.bind(event.params.mid, row.id)
		.first<{ r2_key: string; mime: string }>();
	const obj = media && (await e.BUCKET.get(media.r2_key));
	if (!media || !obj) return apiError('NOT_FOUND', 'This photo is no longer available.', 404);
	return new Response(obj.body, {
		headers: { 'content-type': media.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
	});
};
