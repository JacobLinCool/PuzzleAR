/** Runs the solver in the worker for the current pieces, constraints and confirmed placements. */
import { activeCandidate, edgeKey, solveBasis, type SolutionRecord } from '$lib/shared/doc';
import { turnPlacements, uprightTurns } from '$lib/vision/orient';
import type { HumanConstraint, PieceGeometry, Pin } from '$lib/vision/types';
import { runSolve } from './vision.svelte';
import type { Workspace } from './workspace.svelte';

export type SolveOutcome =
	| { ok: true; solution: SolutionRecord }
	| { ok: false; code: string; message: string };

export async function solvePuzzle(ws: Workspace): Promise<SolveOutcome> {
	const doc = ws.doc;
	if (!doc?.grid) return { ok: false, code: 'NO_GRID', message: 'Choose a grid size first.' };
	await ws.ensurePhoto();
	await ws.refreshGeometry();
	const pieces = [...ws.pieces].sort((a, b) => a.label - b.label);
	const geoms = pieces.map((p) => ws.geom(p));
	const missing = pieces.filter((_, i) => !geoms[i]);
	if (missing.length) {
		return { ok: false, code: 'BAD_CONTOUR', message: `We could not read the outline of ${missing.map((p) => '#' + String(p.label).padStart(2, '0')).join(', ')}. Fix it on the Review step.` };
	}
	const index = new Map(pieces.map((p, i) => [p.id, i]));
	const constraints: HumanConstraint[] = doc.constraints
		.filter((c) => index.has(c.pieceA) && index.has(c.pieceB))
		.map((c) => ({ id: c.id, type: c.type, a: index.get(c.pieceA)!, sideA: c.sideA, b: index.get(c.pieceB)!, sideB: c.sideB }));
	const pins: Pin[] = doc.placements
		.filter((p) => index.has(p.pieceId))
		.map((p) => ({ piece: index.get(p.pieceId)!, row: p.row, col: p.col, rot: p.rot }));
	const basis = solveBasis(doc);
	const { result, parts } = await runSolve({
		tableKey: basis,
		geoms: geoms as NonNullable<(typeof geoms)[number]>[],
		rows: doc.grid.rows,
		cols: doc.grid.cols,
		constraints,
		pins
	});
	if (!result.ok) return { ok: false, code: result.code, message: result.message };
	// confirmed placements fix the orientation; otherwise start upright
	if (!pins.length) {
		for (const c of result.candidates) {
			const steps = uprightTurns(c.placements, geoms as PieceGeometry[], doc.grid.rows, doc.grid.cols);
			if (steps) c.placements = turnPlacements(c.placements, doc.grid.rows, doc.grid.cols, steps);
		}
	}

	const scores: SolutionRecord['scores'] = {};
	for (const [k, v] of Object.entries(parts)) {
		const [ia, ib] = k.split('-').map(Number);
		scores[edgeKey(pieces[ia >> 2].id, ia & 3, pieces[ib >> 2].id, ib & 3)] = { shape: v.shape, color: v.color, length: v.length };
	}
	const solution: SolutionRecord = {
		id: crypto.randomUUID(),
		basis,
		rows: doc.grid.rows,
		cols: doc.grid.cols,
		createdAt: Date.now(),
		relaxed: result.relaxed,
		timedOut: result.timedOut,
		scores,
		candidates: result.candidates.map((c) => ({
			objective: Math.round(c.objective * 1000) / 1000,
			placements: c.placements.map((p) => ({ pieceId: pieces[p.piece].id, row: p.row, col: p.col, rot: p.rot })),
			edges: c.edges.map((e) => ({
				a: pieces[e.a].id,
				sideA: e.sideA,
				b: pieces[e.b].id,
				sideB: e.sideB,
				confidence: e.confidence,
				reason: e.reason
			}))
		}))
	};
	return { ok: true, solution };
}

/** True when the active solution was computed from the current pieces and grid. */
export function solutionIsCurrent(ws: Workspace): boolean {
	const doc = ws.doc;
	const act = doc && activeCandidate(doc);
	if (!doc || !act || !doc.grid) return false;
	return act.solution.basis === solveBasis(doc) && act.solution.rows === doc.grid.rows && act.solution.cols === doc.grid.cols;
}
