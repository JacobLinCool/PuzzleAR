import type { RequestHandler } from './$types';
import { apiError, env, json, waitUntil } from '$lib/server/http';
import { createSession, purgeExpired } from '$lib/server/session';

export const POST: RequestHandler = async (event) => {
	const body = (await event.request.json().catch(() => ({}))) as { mode?: string };
	const mode = body.mode ?? 'upload';
	if (mode !== 'camera' && mode !== 'upload' && mode !== 'demo') {
		return apiError('BAD_REQUEST', 'mode must be camera, upload or demo', 400);
	}
	const session = await createSession(event, mode);
	// opportunistic retention cleanup in addition to the hourly cron
	waitUntil(event, purgeExpired(env(event), 5).catch(() => 0));
	return json(session, { status: 201 });
};
