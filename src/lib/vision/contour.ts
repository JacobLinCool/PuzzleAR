import type { MaskROI, Pt } from './types';

// 8-neighbourhood, clockwise on screen (y down): E, SE, S, SW, W, NW, N, NE
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

function dirIndex(dx: number, dy: number): number {
	for (let i = 0; i < 8; i++) if (DX[i] === dx && DY[i] === dy) return i;
	return -1;
}

/**
 * Moore-neighbour tracing of the outer boundary of the (single) component.
 * Returns full-frame pixel-centre coordinates, clockwise on screen.
 */
export function traceContour(mask: MaskROI): Pt[] {
	const { width: w, height: h, data } = mask;
	const fg = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;
	let sx = -1,
		sy = -1;
	outer: for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (data[y * w + x]) {
				sx = x;
				sy = y;
				break outer;
			}
		}
	}
	if (sx < 0) return [];
	const pts: Pt[] = [];
	let cx = sx,
		cy = sy;
	let back = 4; // we entered from the west
	const limit = w * h * 4;
	let secondX = -1,
		secondY = -1;
	for (let iter = 0; iter < limit; iter++) {
		pts.push({ x: cx + mask.left, y: cy + mask.top });
		let found = -1;
		for (let k = 1; k <= 8; k++) {
			const d = (back + k) % 8;
			if (fg(cx + DX[d], cy + DY[d])) {
				found = d;
				break;
			}
		}
		if (found < 0) break; // isolated pixel
		const bx = cx + DX[(found + 7) % 8];
		const by = cy + DY[(found + 7) % 8];
		const nx = cx + DX[found];
		const ny = cy + DY[found];
		back = dirIndex(bx - nx, by - ny);
		if (back < 0) back = (found + 4) % 8;
		if (iter === 0) {
			secondX = nx;
			secondY = ny;
		} else if (cx === sx && cy === sy && nx === secondX && ny === secondY) {
			pts.pop();
			break;
		}
		cx = nx;
		cy = ny;
	}
	return signedArea(pts) < 0 ? pts.reverse() : pts;
}

/** Twice the signed area; positive when clockwise on screen. */
export function signedArea(pts: Pt[]): number {
	let a = 0;
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i];
		const q = pts[(i + 1) % pts.length];
		a += p.x * q.y - q.x * p.y;
	}
	return a;
}

/** Closed-curve Gaussian smoothing. */
export function smoothClosed(pts: Pt[], sigma: number): Pt[] {
	const r = Math.ceil(sigma * 2.5);
	const weights: number[] = [];
	let sum = 0;
	for (let k = -r; k <= r; k++) {
		const w = Math.exp((-k * k) / (2 * sigma * sigma));
		weights.push(w);
		sum += w;
	}
	const n = pts.length;
	return pts.map((_, i) => {
		let x = 0,
			y = 0;
		for (let k = -r; k <= r; k++) {
			const p = pts[(i + k + n) % n];
			const w = weights[k + r];
			x += p.x * w;
			y += p.y * w;
		}
		return { x: x / sum, y: y / sum };
	});
}

/** Resamples a closed curve to roughly uniform spacing. */
export function resampleClosed(pts: Pt[], spacing: number): Pt[] {
	const n = pts.length;
	const cum = [0];
	for (let i = 0; i < n; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % n];
		cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y));
	}
	const total = cum[n];
	const count = Math.max(8, Math.round(total / spacing));
	const out: Pt[] = [];
	let seg = 0;
	for (let k = 0; k < count; k++) {
		const t = (k * total) / count;
		while (cum[seg + 1] < t) seg++;
		const a = pts[seg];
		const b = pts[(seg + 1) % n];
		const f = (t - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
		out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
	}
	return out;
}

/** Resamples an open polyline to exactly `count` points by arc length. */
export function resampleOpen(pts: Pt[], count: number): Pt[] {
	const cum = [0];
	for (let i = 1; i < pts.length; i++) {
		cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
	}
	const total = cum[cum.length - 1];
	const out: Pt[] = [];
	let seg = 0;
	for (let k = 0; k < count; k++) {
		const t = (k * total) / (count - 1);
		while (seg < pts.length - 2 && cum[seg + 1] < t) seg++;
		const f = (t - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
		const a = pts[seg];
		const b = pts[seg + 1] ?? a;
		out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
	}
	return out;
}

/**
 * Douglas-Peucker simplification for drawing outlines cheaply. A closed curve
 * (first point repeated at the end) is split at its farthest point first,
 * since a zero-length baseline would collapse it.
 */
export function simplify(pts: Pt[], eps: number): Pt[] {
	if (pts.length < 4) return pts;
	const a = pts[0];
	const b = pts[pts.length - 1];
	if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) {
		let far = 1;
		let best = -1;
		for (let i = 1; i < pts.length - 1; i++) {
			const d = Math.hypot(pts[i].x - a.x, pts[i].y - a.y);
			if (d > best) {
				best = d;
				far = i;
			}
		}
		const first = simplifyOpen(pts.slice(0, far + 1), eps);
		const second = simplifyOpen(pts.slice(far), eps);
		return [...first, ...second.slice(1)];
	}
	return simplifyOpen(pts, eps);
}

function simplifyOpen(pts: Pt[], eps: number): Pt[] {
	if (pts.length < 3) return pts;
	const keep = new Uint8Array(pts.length);
	keep[0] = keep[pts.length - 1] = 1;
	const stack: [number, number][] = [[0, pts.length - 1]];
	while (stack.length) {
		const [i, j] = stack.pop()!;
		const a = pts[i];
		const b = pts[j];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot(dx, dy) || 1;
		let best = -1;
		let bestD = eps;
		for (let k = i + 1; k < j; k++) {
			const d = Math.abs((pts[k].x - a.x) * dy - (pts[k].y - a.y) * dx) / len;
			if (d > bestD) {
				bestD = d;
				best = k;
			}
		}
		if (best >= 0) {
			keep[best] = 1;
			stack.push([i, best], [best, j]);
		}
	}
	return pts.filter((_, i) => keep[i]);
}
