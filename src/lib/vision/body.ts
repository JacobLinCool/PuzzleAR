/**
 * Base-corner estimate that ignores tabs: a morphological opening removes the
 * tabs (they hang on narrow necks), straight lines are fitted to the four sides
 * of what remains, and their intersections are the base corners. Works for
 * pieces where tab shoulders fool a purely local corner detector, and for
 * trapezoids from a tilted camera.
 */
import { traceContour } from './contour';
import type { MaskROI, Pt } from './types';

/**
 * Two-pass chamfer (3-4) distance to the nearest pixel where `inside` is false.
 * `edgeIsZero` treats the area beyond the ROI as such a pixel (true for the
 * distance to background; false for the distance to a core, which never lies outside).
 */
function distance(w: number, h: number, inside: (i: number) => boolean, edgeIsZero = true): Float32Array {
	const E = edgeIsZero ? 3 : 1e9;
	const INF = 1e9;
	const d = new Float32Array(w * h);
	for (let i = 0; i < w * h; i++) d[i] = inside(i) ? INF : 0;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			if (!d[i]) continue;
			let v = d[i];
			if (x > 0) v = Math.min(v, d[i - 1] + 3);
			else v = Math.min(v, E);
			if (y > 0) {
				v = Math.min(v, d[i - w] + 3);
				if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
				if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
			} else v = Math.min(v, E);
			d[i] = v;
		}
	}
	for (let y = h - 1; y >= 0; y--) {
		for (let x = w - 1; x >= 0; x--) {
			const i = y * w + x;
			if (!d[i]) continue;
			let v = d[i];
			if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
			else v = Math.min(v, E);
			if (y < h - 1) {
				v = Math.min(v, d[i + w] + 3);
				if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
				if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
			} else v = Math.min(v, E);
			d[i] = v;
		}
	}
	for (let i = 0; i < w * h; i++) d[i] /= 3;
	return d;
}

/** Keeps only the largest 4-connected component (the body; tab heads detach once eroded). */
function keepLargest(m: Uint8Array, w: number, h: number) {
	const label = new Int32Array(w * h);
	let best = 0,
		bestSize = 0,
		next = 1;
	const stack: number[] = [];
	for (let i = 0; i < w * h; i++) {
		if (!m[i] || label[i]) continue;
		const id = next++;
		let size = 0;
		label[i] = id;
		stack.push(i);
		while (stack.length) {
			const k = stack.pop()!;
			size++;
			const x = k % w;
			for (const n of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, k - w, k + w]) {
				if (n >= 0 && n < w * h && m[n] && !label[n]) {
					label[n] = id;
					stack.push(n);
				}
			}
		}
		if (size > bestSize) {
			bestSize = size;
			best = id;
		}
	}
	for (let i = 0; i < w * h; i++) if (label[i] !== best) m[i] = 0;
}

/** Opening with a disc of radius r (pixels), keeping only the main body. */
export function openMask(mask: MaskROI, r: number): MaskROI {
	const { width: w, height: h, data } = mask;
	const toEdge = distance(w, h, (i) => data[i] === 1);
	const core = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) core[i] = toEdge[i] > r ? 1 : 0;
	keepLargest(core, w, h);
	const toCore = distance(w, h, (i) => core[i] === 0, false);
	const out = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) out[i] = toCore[i] <= r && data[i] ? 1 : 0;
	return { ...mask, data: out };
}

interface Line {
	px: number;
	py: number;
	dx: number;
	dy: number;
}

function fitLine(pts: Pt[]): Line | null {
	if (pts.length < 4) return null;
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
		sxx += (p.x - mx) ** 2;
		syy += (p.y - my) ** 2;
		sxy += (p.x - mx) * (p.y - my);
	}
	const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
	return { px: mx, py: my, dx: Math.cos(th), dy: Math.sin(th) };
}

/** Fit, then drop the worst residuals twice (sockets dent inward, tab stubs bulge out). */
function robustLine(pts: Pt[]): Line | null {
	let cur = pts;
	let line = fitLine(cur);
	for (let round = 0; round < 2 && line; round++) {
		const res = cur.map((p) => Math.abs((p.x - line!.px) * -line!.dy + (p.y - line!.py) * line!.dx));
		const sorted = [...res].sort((a, b) => a - b);
		const cut = Math.max(1, sorted[Math.floor(sorted.length * 0.6)] * 1.5);
		const kept = cur.filter((_, i) => res[i] <= cut);
		if (kept.length < 4) break;
		cur = kept;
		line = fitLine(cur);
	}
	return line;
}

function intersect(a: Line, b: Line): Pt | null {
	const det = a.dx * b.dy - a.dy * b.dx;
	if (Math.abs(det) < 1e-6) return null;
	const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
	return { x: a.px + a.dx * t, y: a.py + a.dy * t };
}

/** Rotation (radians, 0..pi/2) of the minimum-area bounding rectangle. */
function minRectAngle(pts: Pt[]): number {
	let best = 0;
	let bestArea = Infinity;
	for (let deg = 0; deg < 90; deg += 1) {
		const a = (deg * Math.PI) / 180;
		const c = Math.cos(a),
			s = Math.sin(a);
		let x0 = Infinity,
			x1 = -Infinity,
			y0 = Infinity,
			y1 = -Infinity;
		for (const p of pts) {
			const u = p.x * c + p.y * s;
			const v = -p.x * s + p.y * c;
			x0 = Math.min(x0, u);
			x1 = Math.max(x1, u);
			y0 = Math.min(y0, v);
			y1 = Math.max(y1, v);
		}
		const area = (x1 - x0) * (y1 - y0);
		if (area < bestArea) {
			bestArea = area;
			best = a;
		}
	}
	return best;
}

/**
 * Base quadrilateral of a piece (full-frame points, clockwise on screen) or null
 * when the opened body does not look like a quadrilateral.
 */
export function bodyQuad(mask: MaskROI, scale: number): Pt[] | null {
	const opened = openMask(mask, Math.max(3, 0.22 * scale));
	const contour = traceContour(opened);
	if (contour.length < 40) return null;
	let cx = 0,
		cy = 0;
	for (const p of contour) {
		cx += p.x;
		cy += p.y;
	}
	cx /= contour.length;
	cy /= contour.length;
	const local = contour.map((p) => ({ x: p.x - cx, y: p.y - cy }));
	const a = minRectAngle(local);
	const c = Math.cos(a),
		s = Math.sin(a);
	// side frame: u along the rect's x axis, v along its y axis
	const uv = local.map((p) => ({ u: p.x * c + p.y * s, v: -p.x * s + p.y * c }));
	let u0 = Infinity,
		u1 = -Infinity,
		v0 = Infinity,
		v1 = -Infinity;
	for (const q of uv) {
		u0 = Math.min(u0, q.u);
		u1 = Math.max(u1, q.u);
		v0 = Math.min(v0, q.v);
		v1 = Math.max(v1, q.v);
	}
	const hu = (u1 - u0) / 2,
		hv = (v1 - v0) / 2;
	const mu = (u1 + u0) / 2,
		mv = (v1 + v0) / 2;
	// assign each point to its nearest rectangle side, ignoring the rounded corners
	const groups: Pt[][] = [[], [], [], []];
	uv.forEach((q, i) => {
		const du = q.u - mu,
			dv = q.v - mv;
		if (Math.abs(du) > hu * 0.62 && Math.abs(dv) > hv * 0.62) return;
		const dists = [Math.abs(dv + hv), Math.abs(du - hu), Math.abs(dv - hv), Math.abs(du + hu)];
		const k = dists.indexOf(Math.min(...dists));
		groups[k].push(contour[i]);
	});
	const lines = groups.map(robustLine);
	if (lines.some((l) => !l)) return null;
	const quad: Pt[] = [];
	for (let k = 0; k < 4; k++) {
		const p = intersect(lines[(k + 3) % 4]!, lines[k]!);
		if (!p) return null;
		quad.push(p);
	}
	// sanity: roughly square-ish, near-right angles
	const lens = quad.map((p, i) => Math.hypot(quad[(i + 1) % 4].x - p.x, quad[(i + 1) % 4].y - p.y));
	if (Math.min(...lens) < 0.55 * Math.max(...lens)) return null;
	for (let i = 0; i < 4; i++) {
		const p = quad[i],
			pr = quad[(i + 3) % 4],
			nx = quad[(i + 1) % 4];
		const v1x = pr.x - p.x,
			v1y = pr.y - p.y,
			v2x = nx.x - p.x,
			v2y = nx.y - p.y;
		const ang = (Math.acos((v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y))) * 180) / Math.PI;
		if (Math.abs(ang - 90) > 28) return null;
	}
	// clockwise on screen
	let area = 0;
	for (let i = 0; i < 4; i++) area += quad[i].x * quad[(i + 1) % 4].y - quad[(i + 1) % 4].x * quad[i].y;
	return area < 0 ? quad.reverse() : quad;
}
