import type { Pt } from './types';

interface ArmFit {
	dx: number;
	dy: number;
	residual: number;
}

/** Fits a line through pts (PCA) and returns its direction (pointing from pts[0] outward) and RMS residual. */
function fitArm(pts: Pt[]): ArmFit {
	let mx = 0,
		my = 0;
	for (const p of pts) {
		mx += p.x;
		my += p.y;
	}
	mx /= pts.length;
	my /= pts.length;
	let sxx = 0,
		syy = 0,
		sxy = 0;
	for (const p of pts) {
		const x = p.x - mx;
		const y = p.y - my;
		sxx += x * x;
		syy += y * y;
		sxy += x * y;
	}
	const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
	let dx = Math.cos(theta);
	let dy = Math.sin(theta);
	const first = pts[0];
	const last = pts[pts.length - 1];
	if ((last.x - first.x) * dx + (last.y - first.y) * dy < 0) {
		dx = -dx;
		dy = -dy;
	}
	let res = 0;
	for (const p of pts) {
		const d = (p.x - mx) * -dy + (p.y - my) * dx;
		res += d * d;
	}
	return { dx, dy, residual: Math.sqrt(res / pts.length) };
}

export interface CornerCandidate {
	index: number;
	score: number;
	angle: number;
}

/**
 * Scores every contour point as a potential base corner: both arms should be
 * straight and meet at roughly 90 degrees with a convex turn. Tab tips have
 * curved arms; socket necks turn the wrong way.
 */
export function cornerCandidates(contour: Pt[], scale: number, spacing: number): CornerCandidate[] {
	const n = contour.length;
	const k = Math.max(4, Math.round((0.17 * scale) / spacing));
	const scores = new Float64Array(n).fill(Infinity);
	const angles = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const before: Pt[] = [];
		const after: Pt[] = [];
		for (let j = 0; j <= k; j++) {
			before.push(contour[(i - j + n) % n]);
			after.push(contour[(i + j) % n]);
		}
		const a = fitArm(before);
		const b = fitArm(after);
		// angle between arms pointing away from the corner
		const cos = a.dx * b.dx + a.dy * b.dy;
		const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
		// convex turn for a clockwise (screen) contour: incoming dir x outgoing dir > 0
		const turn = -a.dx * b.dy - -a.dy * b.dx;
		if (turn <= 0) continue;
		angles[i] = angle;
		scores[i] = Math.abs(angle - 90) / 25 + (a.residual + b.residual) / (0.012 * scale);
	}
	const out: CornerCandidate[] = [];
	const win = Math.max(2, Math.round(k * 0.6));
	for (let i = 0; i < n; i++) {
		const s = scores[i];
		if (!(s < 4)) continue;
		let isMin = true;
		for (let j = -win; j <= win && isMin; j++) {
			if (j && scores[(i + j + n) % n] < s) isMin = false;
		}
		if (isMin) out.push({ index: i, score: s, angle: angles[i] });
	}
	return out.sort((p, q) => p.score - q.score).slice(0, 14).sort((p, q) => p.index - q.index);
}

export interface CornerChoice {
	indices: [number, number, number, number];
	cost: number;
	ok: boolean;
}

/** Picks four candidates (in contour order) forming the most rectangle-like base. */
export function chooseCorners(
	contour: Pt[],
	cands: CornerCandidate[],
	maskArea: number
): CornerChoice | null {
	const m = cands.length;
	if (m < 4) return null;
	let best: CornerChoice | null = null;
	for (let a = 0; a < m; a++)
		for (let b = a + 1; b < m; b++)
			for (let c = b + 1; c < m; c++)
				for (let d = c + 1; d < m; d++) {
					const ids = [cands[a], cands[b], cands[c], cands[d]];
					const q = ids.map((x) => contour[x.index]);
					const lens = q.map((p, i) => Math.hypot(q[(i + 1) % 4].x - p.x, q[(i + 1) % 4].y - p.y));
					if (Math.min(...lens) < 0.35 * Math.max(...lens)) continue;
					let angleDev = 0;
					for (let i = 0; i < 4; i++) {
						const p = q[i];
						const prev = q[(i + 3) % 4];
						const next = q[(i + 1) % 4];
						const v1x = prev.x - p.x,
							v1y = prev.y - p.y,
							v2x = next.x - p.x,
							v2y = next.y - p.y;
						const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y));
						angleDev += Math.abs((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI - 90);
					}
					const opp = Math.abs(Math.log(lens[0] / lens[2])) + Math.abs(Math.log(lens[1] / lens[3]));
					const aspect = Math.abs(Math.log((lens[0] + lens[2]) / (lens[1] + lens[3])));
					let quadArea = 0;
					for (let i = 0; i < 4; i++) quadArea += q[i].x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * q[i].y;
					quadArea = Math.abs(quadArea) / 2;
					const areaPen = Math.abs(Math.log(quadArea / maskArea));
					const cornerScore = ids.reduce((s, x) => s + x.score, 0);
					const cost =
						cornerScore * 0.6 + angleDev / 8 + opp * 6 + Math.max(0, aspect - 0.25) * 6 + areaPen * 4;
					if (!best || cost < best.cost) {
						best = {
							indices: [ids[0].index, ids[1].index, ids[2].index, ids[3].index],
							cost,
							ok: angleDev < 40 && opp < 0.3 && areaPen < 0.45
						};
					}
				}
	return best;
}
