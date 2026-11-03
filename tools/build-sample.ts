/**
 * Publishes the sample session assets into static/sample/<name>/:
 *   photo.jpg, background.jpg   the scattered-piece photo and the empty table plate
 *   sam-stream.txt              a real Meta SAM 3.1 response for photo.jpg
 *   meta.json                   grid size and the pencilled assembly frame
 *   preview.webp / preview.json landing-page preview: real mask outlines and
 *                               the solver's neighbours, computed by this pipeline
 * Usage: pnpm tsx tools/build-sample.ts [name]
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { masksFromResult, parseSamStream, textStream } from '../src/lib/sam/masks';
import { analyzePiece } from '../src/lib/vision/edges';
import { buildMatchTable } from '../src/lib/vision/match';
import { solve } from '../src/lib/vision/solver';
import { simplify } from '../src/lib/vision/contour';

const name = process.argv[2] ?? 'sample-4x4';
const src = join(import.meta.dirname, '../fixtures', name);
const out = join(import.meta.dirname, '../static/sample', name);
mkdirSync(out, { recursive: true });
for (const f of ['photo.jpg', 'background.jpg', 'sam-stream.txt']) copyFileSync(join(src, f), join(out, f));
const gt = JSON.parse(readFileSync(join(src, 'gt.json'), 'utf8'));
writeFileSync(join(out, 'meta.json'), JSON.stringify({ name, rows: gt.rows, cols: gt.cols, width: gt.width, height: gt.height, boardQuad: gt.boardQuad }));

const img = await loadImage(readFileSync(join(src, 'photo.jpg')));
const canvas = createCanvas(img.width, img.height);
const ctx = canvas.getContext('2d');
ctx.drawImage(img, 0, 0);
const pixels = ctx.getImageData(0, 0, img.width, img.height);
const rgba = { width: img.width, height: img.height, data: pixels.data };
const sam = masksFromResult(await parseSamStream(textStream(readFileSync(join(src, 'sam-stream.txt'), 'utf8'))));
const geoms = sam.map((s) => analyzePiece(rgba, s.mask));
const table = buildMatchTable(geoms);
const res = solve({ rows: gt.rows, cols: gt.cols, sideTypes: geoms.map((g) => g.sides.map((s) => s.type)), table });
if (!res.ok) throw new Error('sample did not solve');
const best = res.candidates[0];

// Preview crop: the scattered area (left part of the photo), downscaled.
const crop = { x: 0, y: 0, w: 1330, h: 1536 };
const scale = 760 / crop.w;
const pw = Math.round(crop.w * scale);
const ph = Math.round(crop.h * scale);
const pc = createCanvas(pw, ph);
pc.getContext('2d').drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, pw, ph);
writeFileSync(join(out, 'preview.webp'), pc.toBuffer('image/webp', 82));

// label pieces in reading order like the app does
const order = geoms
	.map((g, i) => ({ i, c: g.centroid }))
	.sort((a, b) => Math.round(a.c.y / 260) - Math.round(b.c.y / 260) || a.c.x - b.c.x);
const labelOf = new Map(order.map((o, k) => [o.i, k + 1]));
const dirNames = ['above', 'right of', 'below', 'left of'];
const pieces = geoms.map((g, i) => {
	const at = best.placements.find((p) => p.piece === i)!;
	const neighbours = [0, 1, 2, 3]
		.map((d) => {
			const r = at.row + [-1, 0, 1, 0][d];
			const c = at.col + [0, 1, 0, -1][d];
			const nb = best.placements.find((p) => p.row === r && p.col === c);
			if (!nb) return null;
			const e = best.edges.find((x) => (x.a === i && x.b === nb.piece) || (x.b === i && x.a === nb.piece));
			return { piece: nb.piece, relation: dirNames[d], confidence: e?.confidence ?? 'check' };
		})
		.filter(Boolean);
	return {
		index: i,
		label: labelOf.get(i),
		outline: simplify(g.outline, 1.5).map((p) => [+((p.x - crop.x) * scale).toFixed(1), +((p.y - crop.y) * scale).toFixed(1)]),
		centroid: [+((g.centroid.x - crop.x) * scale).toFixed(1), +((g.centroid.y - crop.y) * scale).toFixed(1)],
		sides: g.sides.map((s) => s.type),
		cell: [at.row, at.col],
		neighbours
	};
});
writeFileSync(join(out, 'preview.json'), JSON.stringify({ width: pw, height: ph, rows: gt.rows, cols: gt.cols, pieces }));
console.log(`sample ${name}: ${pieces.length} pieces, preview ${pw}x${ph}`);
