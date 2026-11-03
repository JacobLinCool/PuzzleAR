/**
 * Exports real data from the sample puzzle for the explainer animations:
 * piece outlines, scattered poses, one analysed piece and one matching edge pair.
 * Usage: pnpm tsx video/tools/export-data.ts
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { generateJigsaw } from '../../src/lib/shared/jigsaw';
import { masksFromResult, parseSamStream, textStream } from '../../src/lib/sam/masks';
import { analyzePiece } from '../../src/lib/vision/edges';
import { labToRgb } from '../../src/lib/vision/color';
import { simplify } from '../../src/lib/vision/contour';

const root = join(import.meta.dirname, '../..');
const fx = join(root, 'fixtures/sample-4x4');
const out = join(root, 'video/anim/assets');
mkdirSync(out, { recursive: true });
for (const f of ['art.png', 'background.jpg', 'photo.jpg']) copyFileSync(join(fx, f), join(out, f));
copyFileSync(join(root, 'static/sample/sample-4x4/preview.json'), join(out, 'preview.json'));

const gt = JSON.parse(readFileSync(join(fx, 'gt.json'), 'utf8'));
const pieces = generateJigsaw({ rows: 4, cols: 4, cell: 150, seed: 20261104 });

const img = await loadImage(readFileSync(join(fx, 'photo.jpg')));
const c = createCanvas(img.width, img.height);
c.getContext('2d').drawImage(img, 0, 0);
const rgba = { width: img.width, height: img.height, data: c.getContext('2d').getImageData(0, 0, img.width, img.height).data };
const sam = masksFromResult(await parseSamStream(textStream(readFileSync(join(fx, 'sam-stream.txt'), 'utf8'))));
const geoms = sam.map((s) => analyzePiece(rgba, s.mask));
const nearest = (x: number, y: number) =>
	geoms.reduce((bi, g, i) => (Math.hypot(g.centroid.x - x, g.centroid.y - y) < Math.hypot(geoms[bi].centroid.x - x, geoms[bi].centroid.y - y) ? i : bi), 0);

// featured piece: an edge piece (one flat side) at row 0, col 1
const featIdx = gt.pieces.findIndex((p: { row: number; col: number }) => p.row === 0 && p.col === 1);
const feat = geoms[nearest(gt.pieces[featIdx].center.x, gt.pieces[featIdx].center.y)];
const fc = feat.centroid;
const local = (p: { x: number; y: number }) => [+(p.x - fc.x).toFixed(1), +(p.y - fc.y).toFixed(1)];
const strip = (lab: number[]) => {
	const o: string[] = [];
	for (let i = 0; i < 24; i++) {
		const j = Math.floor((i + 0.5) * (lab.length / 3 / 24));
		const [r, g, b] = labToRgb(lab[j * 3], lab[j * 3 + 1], lab[j * 3 + 2]);
		o.push(`rgb(${r},${g},${b})`);
	}
	return o;
};

// matching pair: the right side of (1,1) and the left side of (1,2)
function sideOf(row: number, col: number, dir: number) {
	const g = gt.pieces.find((p: { row: number; col: number }) => p.row === row && p.col === col);
	const geom = geoms[nearest(g.center.x, g.center.y)];
	// pick the detected side whose midpoint lies furthest in direction `dir` of the GT board frame
	const theta = g.pose.theta;
	const dx = [0, 1, 0, -1][dir];
	const dy = [-1, 0, 1, 0][dir];
	const wx = Math.cos(theta) * dx - Math.sin(theta) * dy;
	const wy = Math.sin(theta) * dx + Math.cos(theta) * dy;
	let best = 0;
	let bv = -Infinity;
	geom.sides.forEach((s, k) => {
		const m = s.framePts[Math.floor(s.framePts.length / 2)];
		const v = (m.x - geom.centroid.x) * wx + (m.y - geom.centroid.y) * wy;
		if (v > bv) {
			bv = v;
			best = k;
		}
	});
	const s = geom.sides[best];
	return { type: s.type, length: s.length, pts: s.pts.filter((_, i) => i % 2 === 0).map((p) => [+p.x.toFixed(1), +p.y.toFixed(1)]), strip: strip(s.lab) };
}

const data = {
	cell: 150,
	pieces: pieces.map((p) => ({
		row: p.row,
		col: p.col,
		outline: simplify([...p.outline, p.outline[0]], 0.6).map((q) => [+q.x.toFixed(1), +q.y.toFixed(1)]),
		sides: p.sides
	})),
	poses: gt.pieces.map((p: { pose: { x: number; y: number; theta: number } }) => p.pose),
	boardQuad: gt.boardQuad,
	featured: {
		outline: feat.outline.map(local),
		corners: feat.corners.map(local),
		sides: feat.sides.map((s) => ({ type: s.type, pts: s.framePts.map(local) })),
		bbox: sam[geoms.indexOf(feat)].mask,
		centroid: [fc.x, fc.y]
	},
	pair: { a: sideOf(1, 1, 1), b: sideOf(1, 2, 3), wrong: sideOf(2, 0, 1) }
};
writeFileSync(join(out, 'data.json'), JSON.stringify(data));
console.log('featured sides', data.featured.sides.map((s) => s.type), 'pair', data.pair.a.type, data.pair.b.type, data.pair.wrong.type);
