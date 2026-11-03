/**
 * Renders a top-down "phone photo" of scattered puzzle pieces on a felt mat,
 * with an empty kraft board on the right as the assembly area.
 */
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { generateJigsaw, type JigsawPiece, type Pt } from '../../src/lib/shared/jigsaw';
import { mulberry32 } from '../../src/lib/shared/random';
import { paintArtwork } from './art';

export interface Pose {
	x: number;
	y: number;
	/** radians */
	theta: number;
}

export interface SceneSpec {
	name: string;
	rows: number;
	cols: number;
	cell: number;
	seed: number;
	width: number;
	height: number;
	/** Scatter region [x0, y0, x1, y1]. */
	scatter: [number, number, number, number];
	/** Assembly board centre, size and tilt. */
	board: { cx: number; cy: number; size: number; tilt: number };
	artSeed?: number;
	/** Closer-to-life capture: rounded cuts, uneven tabs, wood, light rims, tilted camera. */
	realism?: {
		cornerRadius: number;
		tabVariation: number;
		jitter: number;
		/** Keystone amount: fraction of the width the top edge shrinks on each side. */
		keystone: number;
		/** Output width after the perspective warp (the photo's real resolution). */
		outWidth: number;
		noBoard?: boolean;
	};
}

export interface Scene {
	spec: SceneSpec;
	art: Canvas;
	pieces: JigsawPiece[];
	poses: Pose[];
	boardQuad: [Pt, Pt, Pt, Pt];
}

export function transform(p: Pt, center: Pt, pose: Pose): Pt {
	const c = Math.cos(pose.theta);
	const s = Math.sin(pose.theta);
	const dx = p.x - center.x;
	const dy = p.y - center.y;
	return { x: pose.x + c * dx - s * dy, y: pose.y + s * dx + c * dy };
}

export function pieceCenter(piece: JigsawPiece, cell: number): Pt {
	return { x: (piece.col + 0.5) * cell, y: (piece.row + 0.5) * cell };
}

function pointInPoly(p: Pt, poly: Pt[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i];
		const b = poly[j];
		if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
			inside = !inside;
		}
	}
	return inside;
}

function tooClose(a: Pt[], b: Pt[], gap: number): boolean {
	for (let i = 0; i < a.length; i += 3) if (pointInPoly(a[i], b)) return true;
	for (let i = 0; i < b.length; i += 3) if (pointInPoly(b[i], a)) return true;
	const g2 = gap * gap;
	for (let i = 0; i < a.length; i += 2) {
		for (let k = 0; k < b.length; k += 2) {
			const dx = a[i].x - b[k].x;
			const dy = a[i].y - b[k].y;
			if (dx * dx + dy * dy < g2) return true;
		}
	}
	return false;
}

export function layoutScene(spec: SceneSpec): Scene {
	const R = spec.realism;
	const pieces = generateJigsaw({
		rows: spec.rows,
		cols: spec.cols,
		cell: spec.cell,
		seed: spec.seed,
		cornerRadius: R?.cornerRadius,
		tabVariation: R?.tabVariation,
		jitter: R?.jitter
	});
	const art = createCanvas(spec.cols * spec.cell, spec.rows * spec.cell);
	paintArtwork(art.getContext('2d'), art.width, art.height, spec.artSeed ?? spec.seed);

	const rand = mulberry32(spec.seed * 31 + 5);
	const [x0, y0, x1, y1] = spec.scatter;
	const order = pieces.map((_, i) => i).sort(() => rand() - 0.5);
	const placed: Pt[][] = [];
	const poses: Pose[] = new Array(pieces.length);
	for (const idx of order) {
		const piece = pieces[idx];
		const center = pieceCenter(piece, spec.cell);
		let ok = false;
		for (let attempt = 0; attempt < 4000 && !ok; attempt++) {
			const pose = {
				x: x0 + spec.cell + rand() * (x1 - x0 - 2 * spec.cell),
				y: y0 + spec.cell + rand() * (y1 - y0 - 2 * spec.cell),
				theta: rand() * Math.PI * 2
			};
			const poly = piece.outline.map((p) => transform(p, center, pose));
			if (placed.some((other) => tooClose(poly, other, spec.cell * 0.22))) continue;
			placed.push(poly);
			poses[idx] = pose;
			ok = true;
		}
		if (!ok) throw new Error(`could not place piece ${idx}; enlarge scatter region`);
	}

	const { cx, cy, tilt } = spec.board;
	const hw = (spec.cols * spec.cell) / 2;
	const hh = (spec.rows * spec.cell) / 2;
	const quad = [
		{ x: -hw, y: -hh },
		{ x: hw, y: -hh },
		{ x: hw, y: hh },
		{ x: -hw, y: hh }
	].map((p) => ({
		x: cx + p.x * Math.cos(tilt) - p.y * Math.sin(tilt),
		y: cy + p.x * Math.sin(tilt) + p.y * Math.cos(tilt)
	})) as Scene['boardQuad'];

	return { spec, art, pieces, poses, boardQuad: quad };
}

function paintTable(ctx: SKRSContext2D, scene: Scene) {
	const { width: w, height: h } = scene.spec;
	const rand = mulberry32(scene.spec.seed + 99);
	if (scene.spec.realism) {
		// walnut table: base tone, long grain streaks, a few knots
		ctx.fillStyle = '#6b4a2f';
		ctx.fillRect(0, 0, w, h);
		for (let i = 0; i < 900; i++) {
			const y = rand() * h;
			const l = rand() * 0.22 - 0.11;
			ctx.strokeStyle = l > 0 ? `rgba(230,190,140,${l})` : `rgba(30,15,5,${-l})`;
			ctx.lineWidth = 1 + rand() * 4;
			ctx.beginPath();
			ctx.moveTo(-20, y);
			for (let x = 0; x <= w + 40; x += 80) ctx.lineTo(x, y + Math.sin(x / 300 + i) * 6 + (rand() - 0.5) * 2);
			ctx.stroke();
		}
		return;
	}
	ctx.fillStyle = '#2f4a3e';
	ctx.fillRect(0, 0, w, h);
	// felt fibres
	for (let i = 0; i < 26000; i++) {
		const x = rand() * w;
		const y = rand() * h;
		const l = rand() * 0.18 - 0.09;
		ctx.fillStyle = l > 0 ? `rgba(200,230,210,${l})` : `rgba(0,10,5,${-l})`;
		ctx.fillRect(x, y, 1 + rand() * 3, 1 + rand() * 1.5);
	}
	// faint mat grid
	ctx.strokeStyle = 'rgba(210,235,220,0.07)';
	ctx.lineWidth = 2;
	for (let x = 60; x < w; x += 120) {
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, h);
		ctx.stroke();
	}
	for (let y = 60; y < h; y += 120) {
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(w, y);
		ctx.stroke();
	}

	// kraft assembly board with the target frame pencilled on it
	const { cx, cy, size, tilt } = scene.spec.board;
	const q = [
		[-1, -1],
		[1, -1],
		[1, 1],
		[-1, 1]
	].map(([sx, sy]) => ({
		x: cx + (sx * size) / 2 * Math.cos(tilt) - (sy * size) / 2 * Math.sin(tilt),
		y: cy + (sx * size) / 2 * Math.sin(tilt) + (sy * size) / 2 * Math.cos(tilt)
	}));
	ctx.save();
	ctx.shadowColor = 'rgba(0,0,0,0.35)';
	ctx.shadowBlur = 18;
	ctx.shadowOffsetY = 6;
	ctx.fillStyle = '#d8c39b';
	ctx.beginPath();
	q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
	ctx.closePath();
	ctx.fill();
	ctx.restore();
	ctx.save();
	ctx.clip();
	for (let i = 0; i < 5000; i++) {
		const x = rand() * w;
		const y = rand() * h;
		ctx.fillStyle = `rgba(120,90,50,${rand() * 0.08})`;
		ctx.fillRect(x, y, 2, 1);
	}
	ctx.restore();
	ctx.strokeStyle = 'rgba(70,55,40,0.55)';
	ctx.lineWidth = 2;
	ctx.setLineDash([10, 7]);
	ctx.beginPath();
	scene.boardQuad.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
	ctx.closePath();
	ctx.stroke();
	ctx.setLineDash([]);
}

/** Draws one piece (art clipped by its outline) at a pose, with shadow and bevel. */
export function drawPiece(ctx: SKRSContext2D, scene: Scene, idx: number, pose: Pose) {
	const piece = scene.pieces[idx];
	const center = pieceCenter(piece, scene.spec.cell);
	const pathPts = piece.outline;
	ctx.save();
	ctx.translate(pose.x, pose.y);
	ctx.rotate(pose.theta);
	ctx.translate(-center.x, -center.y);
	const trace = () => {
		ctx.beginPath();
		pathPts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
		ctx.closePath();
	};
	// shadow
	ctx.save();
	ctx.shadowColor = 'rgba(0,0,0,0.5)';
	ctx.shadowBlur = 10;
	ctx.shadowOffsetX = 3;
	ctx.shadowOffsetY = 5;
	trace();
	ctx.fillStyle = '#e9e1d0';
	ctx.fill();
	ctx.restore();
	// face
	ctx.save();
	trace();
	ctx.clip();
	ctx.drawImage(scene.art, 0, 0);
	ctx.restore();
	// bevel / cut edge
	trace();
	const rim = Boolean(scene.spec.realism);
	ctx.strokeStyle = rim ? 'rgba(250,248,240,0.95)' : 'rgba(255,250,235,0.45)';
	ctx.lineWidth = rim ? 3.2 : 1.6;
	ctx.stroke();
	ctx.restore();
}

export function renderScene(
	scene: Scene,
	opts: { poses?: (Pose | null)[]; seedOffset?: number } = {}
): Canvas {
	const { width: w, height: h } = scene.spec;
	const canvas = createCanvas(w, h);
	const ctx = canvas.getContext('2d');
	paintTable(ctx, scene);
	const poses = opts.poses ?? scene.poses;
	poses.forEach((pose, i) => pose && drawPiece(ctx, scene, i, pose));
	// lighting falloff and sensor noise
	const light = ctx.createRadialGradient(w * 0.45, h * 0.4, w * 0.1, w * 0.5, h * 0.5, w * 0.75);
	light.addColorStop(0, 'rgba(255,245,225,0.06)');
	light.addColorStop(1, 'rgba(0,0,0,0.28)');
	ctx.fillStyle = light;
	ctx.fillRect(0, 0, w, h);
	const rand = mulberry32(scene.spec.seed + 1234 + (opts.seedOffset ?? 0));
	const img = ctx.getImageData(0, 0, w, h);
	const d = img.data;
	for (let i = 0; i < d.length; i += 4) {
		const n = (rand() - 0.5) * 9;
		d[i] = Math.max(0, Math.min(255, d[i] + n));
		d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
		d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}

/** Pose that puts a piece in its solved cell inside the assembly board. */
export function boardPose(scene: Scene, idx: number): Pose {
	const { cell, rows, cols } = scene.spec;
	const piece = scene.pieces[idx];
	const { cx, cy, tilt } = scene.spec.board;
	const lx = (piece.col + 0.5) * cell - (cols * cell) / 2;
	const ly = (piece.row + 0.5) * cell - (rows * cell) / 2;
	return {
		x: cx + lx * Math.cos(tilt) - ly * Math.sin(tilt),
		y: cy + lx * Math.sin(tilt) + ly * Math.cos(tilt),
		theta: tilt
	};
}
