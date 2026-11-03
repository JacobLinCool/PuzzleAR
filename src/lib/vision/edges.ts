import { rgbToLab, sampleRGB } from './color';
import { resampleClosed, resampleOpen, signedArea, simplify, smoothClosed, traceContour } from './contour';
import { bodyQuad } from './body';
import { applyLinear, IDENTITY, invertLinear, type Linear } from './rectify';
import { chooseCorners, cornerCandidates } from './corners';
import { cleanMask, maskArea } from './mask';
import type { MaskROI, PieceGeometry, Pt, RGBAImage, SideGeom, SideType } from './types';

export const SIDE_SAMPLES = 128;
const SPACING = 1.5;

/** Signed area between a side and its chord, over length squared (outward positive). */
export function sideArea(pts: Pt[], length: number): number {
	let a = 0;
	for (let i = 1; i < pts.length; i++) a += (pts[i].x - pts[i - 1].x) * (pts[i].y + pts[i - 1].y) * 0.5;
	return a / (length * length);
}

/**
 * Flat when the side barely leaves its chord. Otherwise the sign of the area
 * between side and chord decides: a tab adds area outward, a socket removes it,
 * while the small opposite bulges beside a neck contribute little. Peak height
 * alone misreads small sockets, whose neck bulges are nearly as tall.
 */
export function classifySide(pts: Pt[], length: number): { type: SideType; amplitude: number } {
	let max = 0,
		min = 0;
	for (const p of pts) {
		max = Math.max(max, p.y);
		min = Math.min(min, p.y);
	}
	const hi = max / length;
	const lo = min / length;
	const area = sideArea(pts, length);
	if (hi < 0.075 && lo > -0.075) return { type: 'flat', amplitude: area };
	// one-sided excursions are unambiguous
	if (hi > 0.12 && lo > -0.08) return { type: 'tab', amplitude: area };
	if (lo < -0.12 && hi < 0.08) return { type: 'socket', amplitude: area };
	if (area > 0.01 && hi > 0.1) return { type: 'tab', amplitude: area };
	if (area < -0.01 && lo < -0.1) return { type: 'socket', amplitude: area };
	return { type: 'unknown', amplitude: area };
}

function nearestIndex(contour: Pt[], p: Pt): number {
	let best = 0;
	let bestD = Infinity;
	for (let i = 0; i < contour.length; i++) {
		const d = (contour[i].x - p.x) ** 2 + (contour[i].y - p.y) ** 2;
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
}

/**
 * One side between two corner indices. Geometry is measured on `geo` (the
 * contour after foreshortening correction); colours are sampled from the photo
 * at the same points mapped back through `back`.
 */
function buildSide(
	index: 0 | 1 | 2 | 3,
	geo: Pt[],
	from: number,
	to: number,
	img: RGBAImage,
	mask: MaskROI,
	back: Linear = IDENTITY
): SideGeom {
	const n = geo.length;
	const seg: Pt[] = [];
	for (let i = from; ; i = (i + 1) % n) {
		seg.push(geo[i]);
		if (i === to) break;
	}
	const c0 = geo[from];
	const c1 = geo[to];
	const length = Math.hypot(c1.x - c0.x, c1.y - c0.y);
	const frame = resampleOpen(seg, SIDE_SAMPLES);
	const photoFrame = back === IDENTITY ? frame : frame.map((p) => applyLinear(back, p));
	// Baseline through the straight shoulders at both ends of the side, not the
	// corner-to-corner chord: rounded corners and a slightly misplaced corner
	// would otherwise shift the whole side and bias tab/socket evidence.
	const shoulders = [...frame.slice(6, 26), ...frame.slice(SIDE_SAMPLES - 26, SIDE_SAMPLES - 6)];
	let mx = 0,
		my = 0;
	for (const p of shoulders) {
		mx += p.x;
		my += p.y;
	}
	mx /= shoulders.length;
	my /= shoulders.length;
	let ux = (c1.x - c0.x) / length;
	let uy = (c1.y - c0.y) / length;
	{
		// direction from the two shoulder centroids (robust to a tilted chord)
		const a = frame.slice(6, 26).reduce((s, p) => ({ x: s.x + p.x / 20, y: s.y + p.y / 20 }), { x: 0, y: 0 });
		const b = frame.slice(SIDE_SAMPLES - 26, SIDE_SAMPLES - 6).reduce((s, p) => ({ x: s.x + p.x / 20, y: s.y + p.y / 20 }), { x: 0, y: 0 });
		const dl = Math.hypot(b.x - a.x, b.y - a.y);
		if (dl > length * 0.3) {
			ux = (b.x - a.x) / dl;
			uy = (b.y - a.y) / dl;
		}
	}
	// outward normal for a clockwise (screen) contour
	const nx = uy;
	const ny = -ux;
	const x0 = (c0.x - mx) * ux + (c0.y - my) * uy;
	const pts = frame.map((p) => ({
		x: (p.x - mx) * ux + (p.y - my) * uy - x0,
		y: (p.x - mx) * nx + (p.y - my) * ny
	}));
	const { type, amplitude } = classifySide(pts, length);

	// Color strip a few pixels inside the cut, following the local normal.
	const lab: number[] = [];
	let missing = 0;
	for (let i = 0; i < SIDE_SAMPLES; i++) {
		const a = photoFrame[Math.max(0, i - 3)];
		const b = photoFrame[Math.min(SIDE_SAMPLES - 1, i + 3)];
		let tx = b.x - a.x;
		let ty = b.y - a.y;
		const tl = Math.hypot(tx, ty) || 1;
		tx /= tl;
		ty /= tl;
		const inx = -ty;
		const iny = tx;
		let r = 0,
			g = 0,
			bl = 0,
			cnt = 0;
		for (const depth of [3, 5, 7]) {
			const x = photoFrame[i].x + inx * depth;
			const y = photoFrame[i].y + iny * depth;
			const lx = Math.floor(x) - mask.left;
			const ly = Math.floor(y) - mask.top;
			if (lx < 0 || ly < 0 || lx >= mask.width || ly >= mask.height || !mask.data[ly * mask.width + lx]) continue;
			const s = sampleRGB(img, x, y);
			if (!s) continue;
			r += s[0];
			g += s[1];
			bl += s[2];
			cnt++;
		}
		if (cnt) {
			lab.push(...rgbToLab(r / cnt, g / cnt, bl / cnt));
		} else {
			missing++;
			lab.push(NaN, NaN, NaN);
		}
	}
	// fill gaps from neighbours
	for (let i = 0; i < SIDE_SAMPLES; i++) {
		if (!Number.isNaN(lab[i * 3])) continue;
		let j = 1;
		while (j < SIDE_SAMPLES) {
			const k = [i - j, i + j].find((q) => q >= 0 && q < SIDE_SAMPLES && !Number.isNaN(lab[q * 3]));
			if (k !== undefined) {
				lab[i * 3] = lab[k * 3];
				lab[i * 3 + 1] = lab[k * 3 + 1];
				lab[i * 3 + 2] = lab[k * 3 + 2];
				break;
			}
			j++;
		}
		if (Number.isNaN(lab[i * 3])) lab[i * 3] = lab[i * 3 + 1] = lab[i * 3 + 2] = 50;
	}
	const mean = [0, 0, 0];
	for (let i = 0; i < SIDE_SAMPLES; i++) for (let c = 0; c < 3; c++) mean[c] += lab[i * 3 + c] / SIDE_SAMPLES;
	let spread = 0;
	for (let i = 0; i < SIDE_SAMPLES; i++) {
		spread += Math.hypot(lab[i * 3] - mean[0], lab[i * 3 + 1] - mean[1], lab[i * 3 + 2] - mean[2]);
	}
	spread /= SIDE_SAMPLES;

	return {
		index,
		type,
		length,
		amplitude,
		pts,
		lab,
		labSpread: spread,
		framePts: photoFrame.filter((_, i) => i % 5 === 0 || i === SIDE_SAMPLES - 1),
		quality: type === 'unknown' || missing > SIDE_SAMPLES * 0.3 ? 'review' : 'ok'
	};
}

/**
 * How plausible a corner set is: sides of similar length, opposite sides
 * matching, near-right angles, and every side readable as flat/tab/socket.
 */
function cornerConsistency(contour: Pt[], idx: number[], img: RGBAImage, mask: MaskROI, back: Linear): number {
	const sorted = [...idx].sort((a, b) => a - b);
	const sides = [0, 1, 2, 3].map((k) => buildSide(k as 0 | 1 | 2 | 3, contour, sorted[k], sorted[(k + 1) % 4], img, mask, back));
	const lens = sides.map((s) => s.length);
	const spread = Math.log(Math.max(...lens) / Math.min(...lens));
	const opp = Math.abs(Math.log(lens[0] / lens[2])) + Math.abs(Math.log(lens[1] / lens[3]));
	let angle = 0;
	for (let k = 0; k < 4; k++) {
		const p = contour[sorted[k]];
		const a = contour[sorted[(k + 3) % 4]];
		const b = contour[sorted[(k + 1) % 4]];
		const cos = ((a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y)) / (Math.hypot(a.x - p.x, a.y - p.y) * Math.hypot(b.x - p.x, b.y - p.y));
		angle += Math.abs((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI - 90);
	}
	const unknown = sides.filter((s) => s.type === 'unknown').length;
	const flats = sides.map((s) => s.type === 'flat');
	const nFlat = flats.filter(Boolean).length;
	const badFlats = nFlat > 2 || (nFlat === 2 && !flats.some((f, i) => f && flats[(i + 1) % 4])) ? 2 : 0;
	return spread * 6 + opp * 4 + angle / 15 + unknown * 1.2 + badFlats;
}

export interface AnalyzeOptions {
	/** Manual corner override (full-frame, any order around the piece). */
	corners?: [Pt, Pt, Pt, Pt];
	/** Manual side type override, keyed by side index. */
	sideTypes?: Partial<Record<number, SideType>>;
	/** Foreshortening correction for the whole photo (see rectify.ts). */
	rectify?: Linear;
}

/** Extracts contour, base corners and four side descriptors for one piece. */
export function analyzePiece(img: RGBAImage, rawMask: MaskROI, opts: AnalyzeOptions = {}): PieceGeometry {
	const { mask, components } = cleanMask(rawMask);
	const area = maskArea(mask);
	const issues: string[] = [];
	if (components > 1) issues.push('Mask has more than one part');
	const traced = traceContour(mask);
	if (traced.length < 20) throw new Error('BAD_CONTOUR');
	let contour = resampleClosed(smoothClosed(resampleClosed(traced, 1), 1.2), SPACING);
	if (signedArea(contour) < 0) contour = contour.reverse();
	const scale = Math.sqrt(area);
	// geometry is measured on the foreshortening-corrected contour (same indices)
	const R = opts.rectify ?? IDENTITY;
	const back = R === IDENTITY ? IDENTITY : invertLinear(R);
	const geo = R === IDENTITY ? contour : contour.map((p) => applyLinear(R, p));

	let idx: number[];
	let cornersOk = true;
	if (opts.corners) {
		// snap manual corners to the contour; contour order makes them clockwise
		idx = opts.corners.map((p) => nearestIndex(contour, p));
		idx.sort((a, b) => a - b);
	} else {
		// Two estimates: the tab-free body fit and the local corner detector.
		// Keep the one whose four sides read most consistently.
		const options: { idx: number[]; ok: boolean }[] = [];
		const quad = bodyQuad(mask, scale);
		const snapped = quad?.map((p) => nearestIndex(contour, p)).sort((a, b) => a - b);
		if (snapped && new Set(snapped).size === 4) options.push({ idx: snapped, ok: true });
		const choice = chooseCorners(geo, cornerCandidates(geo, scale, SPACING), area);
		if (choice) options.push({ idx: [...choice.indices], ok: choice.ok });
		let best: { idx: number[]; ok: boolean; cost: number } | null = null;
		for (const o of options) {
			const cost = cornerConsistency(geo, o.idx, img, mask, back);
			if (!best || cost < best.cost) best = { ...o, cost };
		}
		if (best) {
			idx = best.idx;
			cornersOk = best.ok && best.cost < 3.5;
		} else {
			// fallback: extremes along the diagonals
			const cx = contour.reduce((s, p) => s + p.x, 0) / contour.length;
			const cy = contour.reduce((s, p) => s + p.y, 0) / contour.length;
			const dirs = [
				[-1, -1],
				[1, -1],
				[1, 1],
				[-1, 1]
			];
			idx = dirs.map(([dx, dy]) => {
				let bi = 0,
					bv = -Infinity;
				contour.forEach((p, i) => {
					const v = (p.x - cx) * dx + (p.y - cy) * dy;
					if (v > bv) {
						bv = v;
						bi = i;
					}
				});
				return bi;
			});
			idx.sort((a, b) => a - b);
			cornersOk = false;
		}
	}
	if (!cornersOk) issues.push('Corners need a check');

	// start from the corner nearest the top-left of the frame for a stable order
	let start = 0;
	let bestSum = Infinity;
	idx.forEach((k, i) => {
		const s = contour[k].x + contour[k].y;
		if (s < bestSum) {
			bestSum = s;
			start = i;
		}
	});
	idx = [...idx.slice(start), ...idx.slice(0, start)];

	const sides = [0, 1, 2, 3].map((k) =>
		buildSide(k as 0 | 1 | 2 | 3, geo, idx[k], idx[(k + 1) % 4], img, mask, back)
	) as PieceGeometry['sides'];
	for (const [k, t] of Object.entries(opts.sideTypes ?? {})) {
		if (t) sides[Number(k)] = { ...sides[Number(k)], type: t, quality: 'ok' };
	}
	const flats = sides.map((s) => s.type === 'flat');
	const nFlat = flats.filter(Boolean).length;
	if (nFlat > 2) issues.push('More than two flat sides');
	if (nFlat === 2 && !flats.some((f, i) => f && flats[(i + 1) % 4])) issues.push('Flat sides are opposite');
	if (sides.some((s) => s.type === 'unknown')) issues.push('A side shape is unclear');

	let cx = 0,
		cy = 0;
	for (let y = 0; y < mask.height; y++)
		for (let x = 0; x < mask.width; x++)
			if (mask.data[y * mask.width + x]) {
				cx += x;
				cy += y;
			}
	return {
		area,
		centroid: { x: mask.left + cx / area + 0.5, y: mask.top + cy / area + 0.5 },
		outline: simplify([...contour, contour[0]], 0.8),
		corners: idx.map((k) => contour[k]) as PieceGeometry['corners'],
		cornersOk,
		sides,
		issues,
		scale: (sides[0].length + sides[1].length + sides[2].length + sides[3].length) / 4
	};
}
