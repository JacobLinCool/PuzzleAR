import type { RequestHandler } from './$types';
import { activeCandidate, activePieces } from '$lib/shared/doc';
import { apiError } from '$lib/server/http';
import { authorize, parseDoc } from '$lib/server/session';

/** solution.json: the board, piece positions in the photo and how each placement was confirmed. */
export const GET: RequestHandler = async (event) => {
	const row = await authorize(event, event.params.id);
	if (row instanceof Response) return row;
	if ((event.url.searchParams.get('format') ?? 'json') !== 'json') {
		return apiError('BAD_REQUEST', 'The assembled PNG is rendered in your browser; use format=json here.', 400);
	}
	const doc = parseDoc(row);
	const act = activeCandidate(doc);
	const pieces = activePieces(doc);
	const body = {
		session: row.id,
		exportedAt: new Date().toISOString(),
		grid: doc.grid,
		segmentation: doc.segment && { model: 'sam-3.1', prompt: doc.segment.prompt, preprocessed: doc.segment.preprocessed },
		pieces: pieces.map((p) => ({ id: p.id, label: p.label, origin: p.origin, mask: doc.masks[p.maskKey] && { ...doc.masks[p.maskKey], rle: undefined } })),
		solution: act && {
			objective: act.candidate.objective,
			note: 'Objective is a ranking cost, not a probability.',
			placements: act.candidate.placements,
			edges: act.candidate.edges
		},
		constraints: doc.constraints,
		placements: doc.placements
	};
	return new Response(JSON.stringify(body, null, 2), {
		headers: {
			'content-type': 'application/json',
			'content-disposition': `attachment; filename="puzzlear-${row.id}-solution.json"`,
			'cache-control': 'no-store'
		}
	});
};
