import { SIDE_SAMPLES } from './edges';
import type { PieceGeometry, Pt, SideGeom } from './types';

export const WEIGHTS = { shape: 0.55, color: 0.3, length: 0.15 };
export const TOP_K = 8;
const UNKNOWN_PENALTY = 0.8;

export interface PairScore {
	/** Normalised ranking cost (lower is better); not a probability. */
	cost: number;
	/** Shape misfit relative to the median candidate pair (1 = typical). */
	shape: number;
	/** Color seam difference relative to the median candidate pair. */
	color: number;
	/** Relative length difference, |La - Lb| / max. */
	length: number;
}

/** Costs between every pair of sides: index (piece*4+side) x (piece*4+side). */
export interface MatchTable {
	n: number;
	cost: Float64Array;
	parts: Map<number, PairScore>;
	/** Per side: best candidate sides, ascending cost. */
	top: number[][];
}

function compatible(a: SideGeom, b: SideGeom): boolean {
	if (a.type === 'flat' || b.type === 'flat') return false;
	if (a.type === 'unknown' || b.type === 'unknown') return true;
	return a.type !== b.type;
}

/** Side B as seen from side A's frame: reversed and mirrored across the chord, unit length. */
function mate(b: SideGeom): Pt[] {
	const out: Pt[] = [];
	for (let i = b.pts.length - 1; i >= 0; i--) out.push({ x: (b.length - b.pts[i].x) / b.length, y: -b.pts[i].y / b.length });
	return out;
}

function nnMean(src: Pt[], dst: Pt[]): number {
	let sum = 0;
	for (const p of src) {
		let best = Infinity;
		for (const q of dst) {
			const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
			if (d < best) best = d;
		}
		sum += Math.sqrt(best);
	}
	return sum / src.length;
}

/**
 * Shape misfit: both sides scaled to unit length (two pieces lying at different
 * distances from a tilted camera appear at different sizes), B's mate aligned to
 * A with a few rigid ICP steps, then the symmetric mean nearest distance.
 */
export function shapeCost(a: SideGeom, b: SideGeom): number {
	const As = a.pts.map((p) => ({ x: p.x / a.length - 0.5, y: p.y / a.length }));
	let B = mate(b).map((p) => ({ x: p.x - 0.5, y: p.y }));
	for (let iter = 0; iter < 6; iter++) {
		// correspondences by nearest neighbour from B to A (subsampled)
		let mx = 0,
			my = 0,
			nx = 0,
			ny = 0;
		const pairs: [Pt, Pt][] = [];
		for (let i = 0; i < B.length; i += 2) {
			const p = B[i];
			let best = Infinity;
			let q = As[0];
			for (const c of As) {
				const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
				if (d < best) {
					best = d;
					q = c;
				}
			}
			pairs.push([p, q]);
			mx += p.x;
			my += p.y;
			nx += q.x;
			ny += q.y;
		}
		mx /= pairs.length;
		my /= pairs.length;
		nx /= pairs.length;
		ny /= pairs.length;
		let sxy = 0,
			sxx = 0;
		for (const [p, q] of pairs) {
			const px = p.x - mx,
				py = p.y - my,
				qx = q.x - nx,
				qy = q.y - ny;
			sxx += px * qx + py * qy;
			sxy += px * qy - py * qx;
		}
		let theta = Math.atan2(sxy, sxx);
		theta = Math.max(-0.12, Math.min(0.12, theta));
		const c = Math.cos(theta);
		const s = Math.sin(theta);
		B = B.map((p) => {
			const x = p.x - mx;
			const y = p.y - my;
			return { x: c * x - s * y + nx, y: s * x + c * y + ny };
		});
	}
	return (nnMean(As, B) + nnMean(B, As)) / 2;
}

/** Mean CIE76 color difference along the two inside strips (corners trimmed). */
export function colorCost(a: SideGeom, b: SideGeom): number {
	const lo = Math.floor(SIDE_SAMPLES * 0.08);
	const hi = SIDE_SAMPLES - lo;
	let sum = 0;
	for (let i = lo; i < hi; i++) {
		const j = SIDE_SAMPLES - 1 - i;
		sum += Math.hypot(
			a.lab[i * 3] - b.lab[j * 3],
			a.lab[i * 3 + 1] - b.lab[j * 3 + 1],
			a.lab[i * 3 + 2] - b.lab[j * 3 + 2]
		);
	}
	return sum / (hi - lo);
}

function median(xs: number[]): number {
	if (!xs.length) return 1;
	const s = [...xs].sort((p, q) => p - q);
	return s[Math.floor(s.length / 2)] || 1;
}

export function buildMatchTable(pieces: PieceGeometry[]): MatchTable {
	const n = pieces.length * 4;
	const cost = new Float64Array(n * n).fill(Infinity);
	const raw: { i: number; j: number; shape: number; color: number; length: number; unknown: boolean; weakColor: boolean }[] = [];
	for (let i = 0; i < n; i++) {
		const pa = Math.floor(i / 4);
		const a = pieces[pa].sides[i % 4];
		for (let j = i + 1; j < n; j++) {
			const pb = Math.floor(j / 4);
			if (pa === pb) continue;
			const b = pieces[pb].sides[j % 4];
			if (!compatible(a, b)) continue;
			const length = Math.abs(a.length - b.length) / Math.max(a.length, b.length);
			// generous: perspective alone can make mating sides differ by 10-15%
			if (length > 0.25) continue;
			raw.push({
				i,
				j,
				shape: shapeCost(a, b),
				color: colorCost(a, b),
				length,
				unknown: a.type === 'unknown' || b.type === 'unknown',
				weakColor: a.labSpread < 2.5 && b.labSpread < 2.5
			});
		}
	}
	const ms = median(raw.map((r) => r.shape));
	const mc = median(raw.map((r) => r.color));
	const parts = new Map<number, PairScore>();
	for (const r of raw) {
		const shape = r.shape / ms;
		const color = r.color / mc;
		// lengths are compared on an absolute scale: a median-normalised term would
		// amplify noise when every piece has the same size
		const length = Math.max(0, r.length - 0.05) / 0.08;
		const wc = r.weakColor ? WEIGHTS.color * 0.4 : WEIGHTS.color;
		const total = (WEIGHTS.shape * shape + wc * color + WEIGHTS.length * length) / (WEIGHTS.shape + wc + WEIGHTS.length);
		const c = total + (r.unknown ? UNKNOWN_PENALTY : 0);
		cost[r.i * n + r.j] = c;
		cost[r.j * n + r.i] = c;
		const score = { cost: c, shape, color, length: r.length };
		parts.set(r.i * n + r.j, score);
		parts.set(r.j * n + r.i, score);
	}
	const top: number[][] = [];
	for (let i = 0; i < n; i++) {
		const row: number[] = [];
		for (let j = 0; j < n; j++) if (Number.isFinite(cost[i * n + j])) row.push(j);
		row.sort((p, q) => cost[i * n + p] - cost[i * n + q]);
		top.push(row.slice(0, TOP_K));
	}
	return { n, cost, parts, top };
}

export interface PairCandidate {
	a: number;
	b: number;
	cost: number;
	mutual: boolean;
	margin: number;
	parts: PairScore;
}

/**
 * Likely neighbours without a full board: for every side, its best partner;
 * pairs where both sides pick each other rank first. Used when the pieces do
 * not form a complete rectangle (a partial pile, missing pieces).
 */
export function likelyPairs(table: MatchTable, forbidden: Set<string> = new Set()): PairCandidate[] {
	const { n, cost, top } = table;
	const key = (i: number, j: number) => (i < j ? `${i}-${j}` : `${j}-${i}`);
	const ok = (i: number, j: number) => Number.isFinite(cost[i * n + j]) && !forbidden.has(key(i, j));
	const best = (i: number, skip = -1) => top[i].find((j) => j !== skip && ok(i, j));
	const seen = new Set<string>();
	const out: PairCandidate[] = [];
	for (let i = 0; i < n; i++) {
		const j = best(i);
		if (j === undefined) continue;
		const k = key(i, j);
		if (seen.has(k)) continue;
		seen.add(k);
		const c = cost[i * n + j];
		const altI = best(i, j);
		const altJ = best(j, i);
		const margin = Math.min(altI !== undefined ? cost[i * n + altI] - c : 1, altJ !== undefined ? cost[j * n + altJ] - c : 1);
		out.push({ a: Math.min(i, j), b: Math.max(i, j), cost: c, mutual: best(j) === i, margin, parts: table.parts.get(i * n + j)! });
	}
	return out.sort((p, q) => Number(q.mutual) - Number(p.mutual) || p.cost - q.cost);
}
