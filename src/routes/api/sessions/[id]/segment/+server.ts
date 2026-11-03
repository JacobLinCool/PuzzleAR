import type { RequestHandler } from './$types';
import { apiError, env } from '$lib/server/http';
import { runSam } from '$lib/server/metaSam';
import { authorize } from '$lib/server/session';

/** Concept segmentation of a whole photo. Streams the provider's SSE body. */
export const POST: RequestHandler = async (event) => {
	const row = await authorize(event, event.params.id);
	if (row instanceof Response) return row;
	const body = (await event.request.json().catch(() => ({}))) as { mediaId?: string; prompt?: string };
	if (!body.mediaId) return apiError('BAD_REQUEST', 'mediaId is required', 400);
	const prompt = (body.prompt ?? env(event).SAM_PROMPT ?? 'jigsaw puzzle piece').trim();
	// a concept prompt is one short noun phrase, never an instruction
	if (!/^[a-z][a-z \-]{1,40}$/i.test(prompt)) return apiError('BAD_REQUEST', 'prompt must be a short noun phrase', 400);
	return runSam(event, row, { mediaId: body.mediaId, kind: 'segment', text: prompt });
};
