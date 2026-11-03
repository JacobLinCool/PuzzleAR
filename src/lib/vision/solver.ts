import type { MatchTable } from './match';
import type {
	BoardEdge,
	HumanConstraint,
	Pin,
	Placement,
	Rotation,
	SideType,
	SolverCandidate
} from './types';

export interface SolveInput {
	rows: number;
	cols: number;
	sideTypes: SideType[][];
	table: MatchTable;
	constraints?: HumanConstraint[];
	pins?: Pin[];
	beamWidth?: number;
	maxTimeMs?: number;
}

export type SolveResult =
	| { ok: true; candidates: SolverCandidate[]; relaxed: boolean; timedOut: boolean }
	| { ok: false; code: 'NO_FEASIBLE_SOLUTION' | 'GRID_MISMATCH'; message: string; conflicting: string[] };

// direction offsets: 0 top, 1 right, 2 bottom, 3 left
const DR = [-1, 0, 1, 0];
const DC = [0, 1, 0, -1];

const BORDER_UNKNOWN_PENALTY = 0.6;
const RELAXED_PENALTY = 4;

interface State {
	cells: Int16Array; // piece*4+rot, -1 empty
	used: Uint8Array;
	cost: number;
}

/** Side index of a piece that faces direction d under rotation q. */
export function sideFacing(d: number, q: number): number {
	return (d - q + 4) % 4;
}

export function solve(input: SolveInput): SolveResult {
	const { rows, cols, sideTypes, table } = input;
	const n = sideTypes.length;
	if (n !== rows * cols) {
		return {
			ok: false,
			code: 'GRID_MISMATCH',
			message: `We found ${n} pieces, but a ${rows}×${cols} grid needs ${rows * cols}.`,
			conflicting: []
		};
	}
	const start = Date.now();
	const budget = input.maxTimeMs ?? 8000;
	const beamWidth = input.beamWidth ?? 384;
	const constraints = input.constraints ?? [];
	const pins = input.pins ?? [];

	const lockOf = new Map<number, number>(); // side id -> partner side id
	const forbidden = new Set<number>();
	for (const c of constraints) {
		const a = c.a * 4 + c.sideA;
		const b = c.b * 4 + c.sideB;
		if (c.type === 'fits') {
			lockOf.set(a, b);
			lockOf.set(b, a);
		} else {
			forbidden.add(a * table.n + b);
			forbidden.add(b * table.n + a);
		}
	}
	const pinAt = new Map<number, Pin>();
	const pinnedPiece = new Map<number, Pin>();
	for (const p of pins) {
		pinAt.set(p.row * cols + p.col, p);
		pinnedPiece.set(p.piece, p);
	}

	let timedOut = false;
	const run = (relaxed: boolean): State[] => {
		let beam: State[] = [{ cells: new Int16Array(n).fill(-1), used: new Uint8Array(n), cost: 0 }];
		for (let cell = 0; cell < n; cell++) {
			const r = Math.floor(cell / cols);
			const c = cell % cols;
			const next: State[] = [];
			const pin = pinAt.get(cell);
			for (const st of beam) {
				for (let p = 0; p < n; p++) {
					if (st.used[p]) continue;
					if (pin && pin.piece !== p) continue;
					const pp = pinnedPiece.get(p);
					if (pp && pp.row * cols + pp.col !== cell) continue;
					for (let q = 0 as Rotation; q < 4; q = (q + 1) as Rotation) {
						if (pin && pin.rot !== q) continue;
						let add = 0;
						let ok = true;
						for (let d = 0; d < 4 && ok; d++) {
							const s = sideFacing(d, q);
							const t = sideTypes[p][s];
							const nr = r + DR[d];
							const nc = c + DC[d];
							const outside = nr < 0 || nc < 0 || nr >= rows || nc >= cols;
							const sid = p * 4 + s;
							if (outside) {
								if (lockOf.has(sid)) ok = false;
								else if (t === 'unknown') add += BORDER_UNKNOWN_PENALTY;
								else if (t !== 'flat') {
									if (relaxed) add += RELAXED_PENALTY;
									else ok = false;
								}
							} else if (t === 'flat') {
								if (relaxed) add += RELAXED_PENALTY;
								else ok = false;
							}
							if (!ok || outside) continue;
							const ncell = nr * cols + nc;
							const nv = st.cells[ncell];
							if (nv < 0) continue;
							// neighbour already placed: score the shared edge
							const np = nv >> 2;
							const nq = nv & 3;
							const ns = sideFacing((d + 2) % 4, nq);
							const nid = np * 4 + ns;
							if (forbidden.has(sid * table.n + nid)) {
								ok = false;
								continue;
							}
							const la = lockOf.get(sid);
							const lb = lockOf.get(nid);
							if ((la !== undefined && la !== nid) || (lb !== undefined && lb !== sid)) {
								ok = false;
								continue;
							}
							const e = table.cost[sid * table.n + nid];
							if (Number.isFinite(e)) add += la === nid ? 0 : e;
							else if (relaxed) add += RELAXED_PENALTY;
							else ok = false;
						}
						if (!ok) continue;
						const cells = st.cells.slice();
						cells[cell] = p * 4 + q;
						const used = st.used.slice();
						used[p] = 1;
						next.push({ cells, used, cost: st.cost + add });
					}
				}
			}
			next.sort((x, y) => x.cost - y.cost);
			beam = next.slice(0, beamWidth);
			if (!beam.length) return [];
			if (Date.now() - start > budget) {
				// over budget: keep only the best few states so the search finishes quickly
				timedOut = true;
				beam.length = Math.min(beam.length, 8);
			}
		}
		return beam;
	};

	let relaxed = false;
	let finals = run(false);
	if (!finals.length) {
		relaxed = true;
		finals = run(true);
	}
	if (!finals.length) {
		return {
			ok: false,
			code: 'NO_FEASIBLE_SOLUTION',
			message: 'Your confirmed fits and pinned pieces cannot all hold at once.',
			conflicting: constraints.map((c) => c.id)
		};
	}

	const firstSeen = new Set<string>();
	const distinct = finals.filter((s) => {
		const key = canonicalKey(s.cells, rows, cols);
		if (firstSeen.has(key)) return false;
		firstSeen.add(key);
		return true;
	});
	const improved = distinct
		.slice(0, 10)
		.map((s) => (Date.now() - start < budget ? improve(s, input, lockOf, forbidden, relaxed) : s));
	// improvements often converge on the same board; keep the beam's other
	// distinct boards as alternatives so the person can still compare options
	finals = [...improved, ...distinct].sort((a, b) => a.cost - b.cost);

	const seen = new Set<string>();
	const picked: State[] = [];
	for (const s of finals) {
		const key = canonicalKey(s.cells, rows, cols);
		if (seen.has(key)) continue;
		seen.add(key);
		picked.push(s);
		if (picked.length === 3) break;
	}
	const candidates = picked.map((s) => describe(s, input, lockOf));
	return { ok: true, candidates, relaxed, timedOut };
}

function scoreBoard(cells: Int16Array, input: SolveInput, lockOf: Map<number, number>, forbidden: Set<number>, relaxed: boolean): number {
	const { rows, cols, sideTypes, table } = input;
	let total = 0;
	for (let cell = 0; cell < cells.length; cell++) {
		const r = Math.floor(cell / cols);
		const c = cell % cols;
		const p = cells[cell] >> 2;
		const q = cells[cell] & 3;
		for (let d = 0; d < 4; d++) {
			const s = sideFacing(d, q);
			const t = sideTypes[p][s];
			const nr = r + DR[d];
			const nc = c + DC[d];
			const outside = nr < 0 || nc < 0 || nr >= rows || nc >= cols;
			const sid = p * 4 + s;
			if (outside) {
				if (lockOf.has(sid)) return Infinity;
				if (t === 'unknown') total += BORDER_UNKNOWN_PENALTY;
				else if (t !== 'flat') {
					if (!relaxed) return Infinity;
					total += RELAXED_PENALTY;
				}
				continue;
			}
			if (t === 'flat') {
				if (!relaxed) return Infinity;
				total += RELAXED_PENALTY;
			}
			if (d !== 1 && d !== 2) continue; // count each internal edge once
			const nv = cells[nr * cols + nc];
			const nid = (nv >> 2) * 4 + sideFacing((d + 2) % 4, nv & 3);
			if (forbidden.has(sid * table.n + nid)) return Infinity;
			const la = lockOf.get(sid);
			const lb = lockOf.get(nid);
			if ((la !== undefined && la !== nid) || (lb !== undefined && lb !== sid)) return Infinity;
			const e = table.cost[sid * table.n + nid];
			if (Number.isFinite(e)) total += la === nid ? 0 : e;
			else if (relaxed) total += RELAXED_PENALTY;
			else return Infinity;
		}
	}
	return total;
}

/** Greedy pairwise swaps and re-rotations until no improvement. */
function improve(s: State, input: SolveInput, lockOf: Map<number, number>, forbidden: Set<number>, relaxed: boolean): State {
	const pinned = new Set((input.pins ?? []).map((p) => p.row * input.cols + p.col));
	let cells = s.cells.slice();
	let best = scoreBoard(cells, input, lockOf, forbidden, relaxed);
	let improved = true;
	let rounds = 0;
	while (improved && rounds++ < 6) {
		improved = false;
		for (let i = 0; i < cells.length; i++) {
			if (pinned.has(i)) continue;
			for (let j = i + 1; j < cells.length; j++) {
				if (pinned.has(j)) continue;
				for (let qi = 0; qi < 4; qi++) {
					for (let qj = 0; qj < 4; qj++) {
						const trial = cells.slice();
						trial[i] = (cells[j] >> 2) * 4 + qi;
						trial[j] = (cells[i] >> 2) * 4 + qj;
						const v = scoreBoard(trial, input, lockOf, forbidden, relaxed);
						if (v < best - 1e-9) {
							best = v;
							cells = trial;
							improved = true;
						}
					}
				}
			}
		}
	}
	return { cells, used: s.used, cost: best };
}

/** Key that is identical for boards equal up to a global rotation. */
export function canonicalKey(cells: Int16Array, rows: number, cols: number): string {
	const variants: string[] = [];
	const turns = rows === cols ? [0, 1, 2, 3] : [0, 2];
	for (const t of turns) {
		const out: number[] = new Array(cells.length);
		for (let cell = 0; cell < cells.length; cell++) {
			const r = Math.floor(cell / cols);
			const c = cell % cols;
			let nr = r,
				nc = c;
			const R = rows,
				C = cols;
			if (t === 1) {
				nr = c;
				nc = R - 1 - r;
			} else if (t === 2) {
				nr = R - 1 - r;
				nc = C - 1 - c;
			} else if (t === 3) {
				nr = C - 1 - c;
				nc = r;
			}
			const outCols = t % 2 ? R : C;
			const v = cells[cell];
			out[nr * outCols + nc] = (v >> 2) * 4 + (((v & 3) + t) % 4);
		}
		variants.push(out.join(','));
	}
	return variants.sort()[0];
}

function describe(s: State, input: SolveInput, lockOf: Map<number, number>): SolverCandidate {
	const { rows, cols, table } = input;
	const placements: Placement[] = [];
	for (let cell = 0; cell < s.cells.length; cell++) {
		placements.push({
			piece: s.cells[cell] >> 2,
			row: Math.floor(cell / cols),
			col: cell % cols,
			rot: (s.cells[cell] & 3) as Rotation
		});
	}
	const edges: BoardEdge[] = [];
	for (let cell = 0; cell < s.cells.length; cell++) {
		const r = Math.floor(cell / cols);
		const c = cell % cols;
		for (const d of [1, 2]) {
			const nr = r + DR[d];
			const nc = c + DC[d];
			if (nr >= rows || nc >= cols) continue;
			const v = s.cells[cell];
			const nv = s.cells[nr * cols + nc];
			const sa = sideFacing(d, v & 3);
			const sb = sideFacing((d + 2) % 4, nv & 3);
			const ia = (v >> 2) * 4 + sa;
			const ib = (nv >> 2) * 4 + sb;
			const cost = table.cost[ia * table.n + ib];
			let confidence: BoardEdge['confidence'];
			let reason: string;
			if (lockOf.get(ia) === ib) {
				confidence = 'confirmed';
				reason = 'You confirmed this fit';
			} else if (!Number.isFinite(cost)) {
				confidence = 'check';
				reason = 'Shapes do not look compatible';
			} else {
				const rankA = table.top[ia].indexOf(ib);
				const rankB = table.top[ib].indexOf(ia);
				const altA = table.top[ia].find((x) => x !== ib);
				const altB = table.top[ib].find((x) => x !== ia);
				const margin = Math.min(
					altA !== undefined ? table.cost[ia * table.n + altA] - cost : 1,
					altB !== undefined ? table.cost[ib * table.n + altB] - cost : 1
				);
				if (rankA === 0 && rankB === 0 && margin > 0.06) {
					confidence = 'strong';
					reason = 'Best mutual match for both edges';
				} else {
					confidence = 'check';
					reason =
						rankA === 0 && rankB === 0
							? 'Another edge scores almost as well'
							: 'Chosen to complete the board, not the top local match';
				}
			}
			edges.push({ a: v >> 2, sideA: sa, b: nv >> 2, sideB: sb, cost, confidence, reason });
		}
	}
	return { objective: s.cost, placements, edges };
}
