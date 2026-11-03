import type { RequestHandler } from './$types';
import { buildObjectPrompt, ObjectPromptError, type PromptObject } from '@meta-sam/parser';
import { apiError, env } from '$lib/server/http';
import { runSam } from '$lib/server/metaSam';
import { authorize } from '$lib/server/session';

/** Box / point refinement for missing or broken pieces (max 16 objects). */
export const POST: RequestHandler = async (event) => {
	const row = await authorize(event, event.params.id);
	if (row instanceof Response) return row;
	const body = (await event.request.json().catch(() => ({}))) as { mediaId?: string; objects?: PromptObject[] };
	if (!body.mediaId || !Array.isArray(body.objects) || !body.objects.length) {
		return apiError('BAD_REQUEST', 'mediaId and at least one object are required', 400);
	}
	if (body.objects.length > 16) return apiError('BAD_REQUEST', 'At most 16 objects per refinement', 400);
	const media = await env(event)
		.DB.prepare('SELECT width, height FROM media WHERE id = ? AND session_id = ?')
		.bind(body.mediaId, row.id)
		.first<{ width: number; height: number }>();
	if (!media) return apiError('NOT_FOUND', 'That photo is not part of this session.', 404);
	let text: string;
	try {
		text = buildObjectPrompt({
			size: { width: media.width, height: media.height },
			objects: body.objects.map((o) => ({ id: o.id, prompts: o.prompts.map((p) => ({ ...p, frame: 0 })) }))
		});
	} catch (err) {
		if (err instanceof ObjectPromptError) return apiError('BAD_REQUEST', `Invalid prompt: ${err.code}`, 400);
		throw err;
	}
	return runSam(event, row, { mediaId: body.mediaId, kind: 'refine', text });
};
