/** Canvas helpers: real-texture cutouts, composed boards and ghost overlays. */
import type { CandidatePlacement, MaskRecord } from '$lib/shared/doc';
import { applyH, applySim, pieceToGrid, type Homography } from '$lib/vision/homography';
import { simplify, traceContour } from '$lib/vision/contour';
import { cleanMask, decodeRLE } from '$lib/vision/mask';
import type { MaskROI, PieceGeometry, Pt } from '$lib/vision/types';

/** Fast outline + centroid of a mask, used before full geometry is ready. */
export function quickOutline(m: MaskROI): { outline: Pt[]; centroid: Pt } {
	const clean = cleanMask(m).mask;
	const pts = traceContour(clean);
	let cx = 0,
		cy = 0,
		n = 0;
	for (let y = 0; y < clean.height; y += 2)
		for (let x = 0; x < clean.width; x += 2)
			if (clean.data[y * clean.width + x]) {
				cx += x;
				cy += y;
				n++;
			}
	return {
		outline: simplify([...pts, pts[0]], 1.2),
		centroid: { x: clean.left + cx / Math.max(1, n), y: clean.top + cy / Math.max(1, n) }
	};
}

const outlineCache = new Map<string, { outline: Pt[]; centroid: Pt }>();
export function outlineFor(key: string, m: MaskRecord) {
	let o = outlineCache.get(key);
	if (!o) {
		o = quickOutline(decodeRLE(m.rle, m));
		outlineCache.set(key, o);
	}
	return o;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i];
		const b = poly[j];
		if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
	}
	return inside;
}

/** The piece cut out of the photo along its mask (canvas sized to the mask box). */
export function makeCutout(photo: CanvasImageSource, m: MaskRecord): HTMLCanvasElement {
	const roi = decodeRLE(m.rle, m);
	const c = document.createElement('canvas');
	c.width = m.width;
	c.height = m.height;
	const ctx = c.getContext('2d')!;
	ctx.drawImage(photo, -m.left, -m.top);
	const img = ctx.getImageData(0, 0, m.width, m.height);
	for (let i = 0; i < roi.data.length; i++) if (!roi.data[i]) img.data[i * 4 + 3] = 0;
	ctx.putImageData(img, 0, 0);
	return c;
}

export interface BoardItem {
	placement: CandidatePlacement;
	geom: PieceGeometry;
	mask: MaskRecord;
	cutout: HTMLCanvasElement;
}

/**
 * Draws pieces into board space. Grid unit = `cell` canvas pixels, offset by
 * `origin`. Each piece is placed with the similarity fitted to its base corners.
 */
export function drawPieceInCell(
	ctx: CanvasRenderingContext2D,
	item: BoardItem,
	cell: number,
	origin: Pt,
	alpha = 1
) {
	const s = pieceToGrid(item.geom.corners, item.placement.row, item.placement.col, item.placement.rot);
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.setTransform(
		s.a * cell,
		s.b * cell,
		-s.b * cell,
		s.a * cell,
		s.tx * cell + origin.x,
		s.ty * cell + origin.y
	);
	ctx.drawImage(item.cutout, item.mask.left, item.mask.top);
	ctx.restore();
}

/** Outline of a piece mapped into board space (grid units). */
export function outlineInGrid(geom: PieceGeometry, p: CandidatePlacement): Pt[] {
	const s = pieceToGrid(geom.corners, p.row, p.col, p.rot);
	return geom.outline.map((q) => applySim(s, q));
}

/** Outline of a piece at its target cell, projected into the camera image. */
export function outlineInImage(geom: PieceGeometry, p: CandidatePlacement, H: Homography): Pt[] {
	return outlineInGrid(geom, p).map((q) => applyH(H, q));
}

/**
 * Local affine approximation of grid -> image around a cell centre, used to
 * draw the ghost texture (canvas 2D cannot draw true perspective).
 */
export function cellAffine(H: Homography, row: number, col: number) {
	const c = { x: col + 0.5, y: row + 0.5 };
	const o = applyH(H, c);
	const ex = applyH(H, { x: c.x + 0.5, y: c.y });
	const ey = applyH(H, { x: c.x, y: c.y + 0.5 });
	return {
		a: (ex.x - o.x) * 2,
		b: (ex.y - o.y) * 2,
		c: (ey.x - o.x) * 2,
		d: (ey.y - o.y) * 2,
		e: o.x - (ex.x - o.x) * 2 * c.x - (ey.x - o.x) * 2 * c.y,
		f: o.y - (ex.y - o.y) * 2 * c.x - (ey.y - o.y) * 2 * c.y
	};
}

/** Matrix taking photo pixels of a piece to its target position in the image (via the board). */
export function ghostMatrix(H: Homography, geom: PieceGeometry, p: CandidatePlacement): DOMMatrix {
	const A = cellAffine(H, p.row, p.col);
	const s = pieceToGrid(geom.corners, p.row, p.col, p.rot);
	return new DOMMatrix([A.a, A.b, A.c, A.d, A.e, A.f]).multiply(new DOMMatrix([s.a, s.b, -s.b, s.a, s.tx, s.ty]));
}

const dataUrls = new WeakMap<HTMLCanvasElement, string>();
export function cutoutUrl(c: HTMLCanvasElement): string {
	let u = dataUrls.get(c);
	if (!u) {
		u = c.toDataURL('image/png');
		dataUrls.set(c, u);
	}
	return u;
}

/** Ghost cutout drawn at its target cell inside a photo/video canvas (image px -> canvas via `view`). */
export function drawGhost(
	ctx: CanvasRenderingContext2D,
	item: BoardItem,
	H: Homography,
	view: { scale: number; x: number; y: number },
	alpha = 0.55
) {
	const A = cellAffine(H, item.placement.row, item.placement.col);
	const s = pieceToGrid(item.geom.corners, item.placement.row, item.placement.col, item.placement.rot);
	// photo -> grid (s), grid -> image (A), image -> canvas (view)
	const m = new DOMMatrix([A.a, A.b, A.c, A.d, A.e, A.f]).multiply(new DOMMatrix([s.a, s.b, -s.b, s.a, s.tx, s.ty]));
	const v = new DOMMatrix([view.scale, 0, 0, view.scale, view.x, view.y]).multiply(m);
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.setTransform(v);
	ctx.drawImage(item.cutout, item.mask.left, item.mask.top);
	ctx.restore();
}

export function tracePath(ctx: CanvasRenderingContext2D, pts: Pt[], map: (p: Pt) => Pt = (p) => p) {
	ctx.beginPath();
	pts.forEach((p, i) => {
		const q = map(p);
		if (i) ctx.lineTo(q.x, q.y);
		else ctx.moveTo(q.x, q.y);
	});
	ctx.closePath();
}

export function svgPath(pts: Pt[]): string {
	return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('') + 'Z';
}

/** Renders the finished board as a PNG blob (real textures, transparent outside). */
export async function renderBoardPNG(items: BoardItem[], rows: number, cols: number, cellPx = 220): Promise<Blob> {
	const pad = Math.round(cellPx * 0.35);
	const canvas = document.createElement('canvas');
	canvas.width = cols * cellPx + pad * 2;
	canvas.height = rows * cellPx + pad * 2;
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#F7F5F0';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.imageSmoothingQuality = 'high';
	for (const it of items) drawPieceInCell(ctx, it, cellPx, { x: pad, y: pad });
	return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG'))), 'image/png'));
}
