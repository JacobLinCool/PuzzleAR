/**
 * Procedural jigsaw cut generator. Produces piece outlines in board coordinates
 * (x right, y down). Used for synthetic fixtures, the landing preview and tests;
 * the solver never sees this data.
 */
import { mulberry32 } from './random';

export type Pt = { x: number; y: number };
export type SideKind = 'flat' | 'tab' | 'socket';

export interface JigsawSpec {
	rows: number;
	cols: number;
	cell: number;
	seed: number;
	/** Tab size relative to the cell side. */
	tabSize?: number;
	jitter?: number;
	/** Samples per cubic segment. */
	samples?: number;
	/** Per-edge relative variation of the tab size (real dies are not uniform). */
	tabVariation?: number;
	/** Rounded base corners, in pixels (real die cuts are never sharp). */
	cornerRadius?: number;
}

export interface JigsawPiece {
	row: number;
	col: number;
	/** Clockwise outline (screen coords) starting at the top-left corner. */
	outline: Pt[];
	/** Indices into outline of the four base corners: TL, TR, BR, BL. */
	cornerIdx: [number, number, number, number];
	/** Side kinds in order top, right, bottom, left. */
	sides: [SideKind, SideKind, SideKind, SideKind];
}

type EdgeCurve = { pts: Pt[]; dir: 1 | -1 } | null;

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number, out: Pt[]) {
	for (let i = 1; i <= n; i++) {
		const t = i / n;
		const m = 1 - t;
		out.push({
			x: m * m * m * p0.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t * t * t * p3.x,
			y: m * m * m * p0.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t * t * t * p3.y
		});
	}
}

/** Unit-space edge curve from (0,0) to (1,0); v>0 is the bump direction. */
function unitEdge(rand: () => number, t: number, j: number, n: number): Pt[] {
	const u = () => (rand() * 2 - 1) * j;
	const a = u(),
		b = u(),
		c = u(),
		d = u(),
		e = u();
	const P = (x: number, y: number): Pt => ({ x, y });
	const p0 = P(0, 0);
	const p1 = P(0.2, a);
	const p2 = P(0.5 + b + d, -t + c);
	const p3 = P(0.5 - t + b, t + c);
	const p4 = P(0.5 - 2 * t + b - d, 3 * t + c);
	const p5 = P(0.5 + 2 * t + b - d, 3 * t + c);
	const p6 = P(0.5 + t + b, t + c);
	const p7 = P(0.5 + b + d, -t + c);
	const p8 = P(0.8, e);
	const p9 = P(1, 0);
	const out: Pt[] = [p0];
	cubic(p0, p1, p2, p3, n, out);
	cubic(p3, p4, p5, p6, n, out);
	cubic(p6, p7, p8, p9, n, out);
	return out;
}

export function generateJigsaw(spec: JigsawSpec): JigsawPiece[] {
	const { rows, cols, cell } = spec;
	const t = spec.tabSize ?? 0.1;
	const j = spec.jitter ?? 0.035;
	const n = spec.samples ?? 14;
	const rand = mulberry32(spec.seed);
	const tv = spec.tabVariation ?? 0;
	const tabFor = () => t * (1 + (rand() * 2 - 1) * tv);

	// h[r][c]: horizontal edge at y = r*cell between columns c..c+1 (r in 0..rows)
	const h: EdgeCurve[][] = [];
	for (let r = 0; r <= rows; r++) {
		h.push([]);
		for (let c = 0; c < cols; c++) {
			if (r === 0 || r === rows) {
				h[r].push(null);
				continue;
			}
			const dir: 1 | -1 = rand() < 0.5 ? 1 : -1;
			const pts = unitEdge(rand, tabFor(), j, n).map((p) => ({
				x: (c + p.x) * cell,
				y: r * cell + p.y * cell * dir
			}));
			h[r].push({ pts, dir });
		}
	}
	// v[r][c]: vertical edge at x = c*cell between rows r..r+1 (c in 0..cols)
	const v: EdgeCurve[][] = [];
	for (let r = 0; r < rows; r++) {
		v.push([]);
		for (let c = 0; c <= cols; c++) {
			if (c === 0 || c === cols) {
				v[r].push(null);
				continue;
			}
			const dir: 1 | -1 = rand() < 0.5 ? 1 : -1;
			const pts = unitEdge(rand, tabFor(), j, n).map((p) => ({
				x: c * cell + p.y * cell * dir,
				y: (r + p.x) * cell
			}));
			v[r].push({ pts, dir });
		}
	}

	const straight = (a: Pt, b: Pt): Pt[] => {
		const out: Pt[] = [];
		const steps = n * 3;
		for (let i = 0; i <= steps; i++) {
			out.push({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
		}
		return out;
	};

	const pieces: JigsawPiece[] = [];
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const tl = { x: c * cell, y: r * cell };
			const tr = { x: (c + 1) * cell, y: r * cell };
			const br = { x: (c + 1) * cell, y: (r + 1) * cell };
			const bl = { x: c * cell, y: (r + 1) * cell };
			const top = h[r][c];
			const right = v[r][c + 1];
			const bottom = h[r + 1][c];
			const left = v[r][c];
			const segs = [
				top ? top.pts : straight(tl, tr),
				right ? right.pts : straight(tr, br),
				bottom ? [...bottom.pts].reverse() : straight(br, bl),
				left ? [...left.pts].reverse() : straight(bl, tl)
			];
			const outline: Pt[] = [];
			const cornerIdx: number[] = [];
			for (const seg of segs) {
				cornerIdx.push(outline.length);
				outline.push(...seg.slice(0, -1));
			}
			const sides: SideKind[] = [
				!top ? 'flat' : top.dir === -1 ? 'tab' : 'socket',
				!right ? 'flat' : right.dir === 1 ? 'tab' : 'socket',
				!bottom ? 'flat' : bottom.dir === 1 ? 'tab' : 'socket',
				!left ? 'flat' : left.dir === -1 ? 'tab' : 'socket'
			];
			if (spec.cornerRadius) roundCorners(outline, cornerIdx, spec.cornerRadius);
			pieces.push({
				row: r,
				col: c,
				outline,
				cornerIdx: cornerIdx as [number, number, number, number],
				sides: sides as JigsawPiece['sides']
			});
		}
	}
	return pieces;
}

/** Replaces the sharp base corners with quadratic arcs of radius r (in place). */
function roundCorners(outline: Pt[], cornerIdx: number[], r: number) {
	const n = outline.length;
	for (const ci of cornerIdx) {
		const c = outline[ci];
		let a = ci,
			b = ci;
		while (Math.hypot(outline[(a - 1 + n) % n].x - c.x, outline[(a - 1 + n) % n].y - c.y) < r && (ci - a) < n / 8) a--;
		while (Math.hypot(outline[(b + 1) % n].x - c.x, outline[(b + 1) % n].y - c.y) < r && (b - ci) < n / 8) b++;
		const p0 = outline[(a - 1 + n) % n];
		const p2 = outline[(b + 1) % n];
		for (let k = a; k <= b; k++) {
			const tt = (k - a + 1) / (b - a + 2);
			const m = 1 - tt;
			outline[(k + n) % n] = { x: m * m * p0.x + 2 * m * tt * c.x + tt * tt * p2.x, y: m * m * p0.y + 2 * m * tt * c.y + tt * tt * p2.y };
		}
	}
}

export function outlineToPath(outline: Pt[]): string {
	return (
		outline.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('') + 'Z'
	);
}
