/** Puzzle-level helpers shared by the Review, Solve and Guide screens. */
import type { CandidateEdge, CandidatePlacement, PieceRecord, PlacementRecord } from '$lib/shared/doc';
import type { PieceGeometry } from '$lib/vision/types';

export const SIDE_NAMES = ['top', 'right', 'bottom', 'left'] as const;

export interface GridOption {
	rows: number;
	cols: number;
	score: number;
	reason: string;
}

/**
 * Grid sizes for N pieces, ranked by how well the counted flat sides fit
 * 2*(rows+cols). Only recommends one when the evidence is clear.
 */
export function gridOptions(geoms: (PieceGeometry | undefined)[]): { options: GridOption[]; recommended?: GridOption } {
	const n = geoms.length;
	const known = geoms.filter(Boolean) as PieceGeometry[];
	const flats = known.reduce((s, g) => s + g.sides.filter((x) => x.type === 'flat').length, 0);
	const corners = known.filter((g) => {
		const f = g.sides.map((s) => s.type === 'flat');
		return f.some((v, i) => v && f[(i + 1) % 4]);
	}).length;
	const options: GridOption[] = [];
	for (let r = 2; r <= n; r++) {
		if (n % r) continue;
		const c = n / r;
		if (c < r || c < 2) continue;
		const expected = 2 * (r + c);
		const score = Math.abs(flats - expected) + Math.abs(corners - 4) * 2;
		options.push({ rows: r, cols: c, score, reason: `${r * c} pieces, ${expected} flat sides expected (we counted ${flats})` });
	}
	options.sort((a, b) => a.score - b.score);
	const [best, second] = options;
	const clear = best && known.length === n && best.score <= 1 && (!second || second.score - best.score >= 2);
	return { options, recommended: clear ? best : undefined };
}

/** Which grid neighbour a direction points to. */
export const DR = [-1, 0, 1, 0];
export const DC = [0, 1, 0, -1];

/** Side of a placed piece that faces direction d. */
export function sideFacing(d: number, rot: number) {
	return (d - rot + 4) % 4;
}

export function cellOf(placements: CandidatePlacement[], row: number, col: number) {
	return placements.find((p) => p.row === row && p.col === col);
}

/** Edges around one cell, with the neighbour and the edge record if any. */
export function cellEdges(placements: CandidatePlacement[], edges: CandidateEdge[], target: CandidatePlacement) {
	const out: { dir: number; neighbour: CandidatePlacement; edge?: CandidateEdge; side: number; neighbourSide: number }[] = [];
	for (let d = 0; d < 4; d++) {
		const nb = cellOf(placements, target.row + DR[d], target.col + DC[d]);
		if (!nb) continue;
		const side = sideFacing(d, target.rot);
		const neighbourSide = sideFacing((d + 2) % 4, nb.rot);
		const edge = edges.find(
			(e) =>
				(e.a === target.pieceId && e.sideA === side && e.b === nb.pieceId) ||
				(e.b === target.pieceId && e.sideB === side && e.a === nb.pieceId)
		);
		out.push({ dir: d, neighbour: nb, edge, side, neighbourSide });
	}
	return out;
}

/**
 * Next best piece: start from a corner, then grow the assembled region,
 * preferring cells that touch the most placed pieces through strong edges.
 */
export function nextStep(
	placements: CandidatePlacement[],
	edges: CandidateEdge[],
	done: PlacementRecord[],
	skipped: string[],
	rows: number,
	cols: number
): CandidatePlacement | undefined {
	const placed = new Set(done.map((d) => `${d.row},${d.col}`));
	const remaining = placements.filter((p) => !placed.has(`${p.row},${p.col}`));
	if (!remaining.length) return undefined;
	const fresh = remaining.filter((p) => !skipped.includes(p.pieceId));
	const pool = fresh.length ? fresh : remaining;
	const scoreOf = (p: CandidatePlacement) => {
		let touching = 0;
		let strong = 0;
		for (let d = 0; d < 4; d++) {
			const r = p.row + DR[d];
			const c = p.col + DC[d];
			if (placed.has(`${r},${c}`)) {
				touching++;
				const nb = cellOf(placements, r, c);
				const e = nb && edges.find((x) => (x.a === p.pieceId && x.b === nb.pieceId) || (x.b === p.pieceId && x.a === nb.pieceId));
				if (e && e.confidence !== 'check') strong++;
			}
		}
		const isCorner = (p.row === 0 || p.row === rows - 1) && (p.col === 0 || p.col === cols - 1);
		const isEdge = p.row === 0 || p.row === rows - 1 || p.col === 0 || p.col === cols - 1;
		if (!placed.size) return (isCorner ? 100 : 0) - p.row * cols - p.col;
		return touching * 10 + strong * 4 + (isEdge ? 2 : 0) - (p.row * cols + p.col) * 0.01;
	};
	return [...pool].sort((a, b) => scoreOf(b) - scoreOf(a))[0];
}

export function labelOf(pieces: PieceRecord[], id: string) {
	const p = pieces.find((x) => x.id === id);
	return p ? `#${String(p.label).padStart(2, '0')}` : '#??';
}

export function formatDuration(ms: number) {
	const m = Math.floor(ms / 60000);
	const s = Math.round((ms % 60000) / 1000);
	return m ? `${m} min ${s} s` : `${s} s`;
}
