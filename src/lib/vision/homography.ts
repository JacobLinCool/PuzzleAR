import type { Pt } from './types';

/** 3x3 row-major projective transform. */
export type Homography = number[];

/** Solves H mapping src[i] -> dst[i] for four point pairs (DLT, h33 = 1). */
export function homographyFromPoints(src: Pt[], dst: Pt[]): Homography | null {
	const A: number[][] = [];
	const b: number[] = [];
	for (let i = 0; i < 4; i++) {
		const { x, y } = src[i];
		const { x: u, y: v } = dst[i];
		A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
		b.push(u);
		A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
		b.push(v);
	}
	const h = solveLinear(A, b);
	return h ? [...h, 1] : null;
}

function solveLinear(A: number[][], b: number[]): number[] | null {
	const n = b.length;
	const M = A.map((row, i) => [...row, b[i]]);
	for (let c = 0; c < n; c++) {
		let piv = c;
		for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
		if (Math.abs(M[piv][c]) < 1e-10) return null;
		[M[c], M[piv]] = [M[piv], M[c]];
		for (let r = 0; r < n; r++) {
			if (r === c) continue;
			const f = M[r][c] / M[c][c];
			for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
		}
	}
	return M.map((row, i) => row[n] / row[i]);
}

export function applyH(H: Homography, p: Pt): Pt {
	const w = H[6] * p.x + H[7] * p.y + H[8];
	return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

export function invertH(H: Homography): Homography {
	const [a, b, c, d, e, f, g, h, i] = H;
	const A = e * i - f * h;
	const B = -(d * i - f * g);
	const C = d * h - e * g;
	const det = a * A + b * B + c * C;
	const inv = [
		A,
		-(b * i - c * h),
		b * f - c * e,
		B,
		a * i - c * g,
		-(a * f - c * d),
		C,
		-(a * h - b * g),
		a * e - b * d
	].map((v) => v / det);
	return inv.map((v) => v / inv[8]);
}

/**
 * Board homography from four tapped corners (TL, TR, BR, BL in image pixels)
 * to grid coordinates where cell (r, c) spans [c, c+1] x [r, r+1].
 * Returns the grid -> image transform and whether the quad is usable.
 */
export function boardHomography(
	quad: Pt[],
	rows: number,
	cols: number
): { H: Homography; valid: boolean; reason?: string } | null {
	const grid = [
		{ x: 0, y: 0 },
		{ x: cols, y: 0 },
		{ x: cols, y: rows },
		{ x: 0, y: rows }
	];
	const H = homographyFromPoints(grid, quad);
	if (!H) return null;
	// convexity and orientation check
	let sign = 0;
	for (let i = 0; i < 4; i++) {
		const a = quad[i];
		const b = quad[(i + 1) % 4];
		const c = quad[(i + 2) % 4];
		const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
		if (!sign) sign = Math.sign(cross);
		else if (Math.sign(cross) !== sign) return { H, valid: false, reason: 'The corners cross over; tap them in order: top-left, top-right, bottom-right, bottom-left.' };
	}
	if (sign < 0) return { H, valid: false, reason: 'Tap the corners clockwise starting at the top-left.' };
	return { H, valid: true };
}

export interface Similarity {
	a: number; // s*cos
	b: number; // s*sin
	tx: number;
	ty: number;
}

/** Least-squares similarity transform mapping src -> dst. */
export function fitSimilarity(src: Pt[], dst: Pt[]): Similarity {
	const n = src.length;
	let sx = 0,
		sy = 0,
		dx = 0,
		dy = 0;
	for (let i = 0; i < n; i++) {
		sx += src[i].x;
		sy += src[i].y;
		dx += dst[i].x;
		dy += dst[i].y;
	}
	sx /= n;
	sy /= n;
	dx /= n;
	dy /= n;
	let num1 = 0,
		num2 = 0,
		den = 0;
	for (let i = 0; i < n; i++) {
		const px = src[i].x - sx;
		const py = src[i].y - sy;
		const qx = dst[i].x - dx;
		const qy = dst[i].y - dy;
		num1 += px * qx + py * qy;
		num2 += px * qy - py * qx;
		den += px * px + py * py;
	}
	const a = num1 / den;
	const b = num2 / den;
	return { a, b, tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy) };
}

export function applySim(s: Similarity, p: Pt): Pt {
	return { x: s.a * p.x - s.b * p.y + s.tx, y: s.b * p.x + s.a * p.y + s.ty };
}

/**
 * Similarity mapping a piece's photo coordinates into grid coordinates for a
 * placement: the side facing `top` lands on the cell's top edge.
 */
export function pieceToGrid(corners: Pt[], row: number, col: number, rot: number): Similarity {
	const top = (4 - rot) % 4;
	const src = [0, 1, 2, 3].map((k) => corners[(top + k) % 4]);
	const dst = [
		{ x: col, y: row },
		{ x: col + 1, y: row },
		{ x: col + 1, y: row + 1 },
		{ x: col, y: row + 1 }
	];
	return fitSimilarity(src, dst);
}
