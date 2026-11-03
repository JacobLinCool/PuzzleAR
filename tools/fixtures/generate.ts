/**
 * Generates synthetic puzzle fixtures with ground truth:
 *   fixtures/<name>/photo.jpg       scattered pieces (what a user would photograph)
 *   fixtures/<name>/background.jpg  the same table with no pieces
 *   fixtures/<name>/after-<k>.jpg   pieces 0..k moved onto the board (verification tests)
 *   fixtures/<name>/gt.json         grid position, pose and outline of every piece
 *
 * Usage: pnpm tsx tools/fixtures/generate.ts [name...]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { applyH, homographyFromPoints, invertH, type Homography } from '../../src/lib/vision/homography';
import { boardPose, layoutScene, pieceCenter, renderScene, transform, type SceneSpec } from './scene';

/** Tilted-camera capture: keystone warp + downscale. Returns the image and the point map. */
function camera(spec: SceneSpec): { shoot: (c: Canvas) => Canvas; map: (p: { x: number; y: number }) => { x: number; y: number } } {
	const R = spec.realism;
	if (!R) return { shoot: (c) => c, map: (p) => p };
	const W = spec.width, H = spec.height;
	const k = R.outWidth / W;
	const ow = R.outWidth, oh = Math.round(H * k);
	const ins = R.keystone * W;
	// scene -> photo: the far (top) edge appears narrower
	const fwd = homographyFromPoints(
		[{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }],
		[{ x: ins * k, y: oh * 0.04 }, { x: (W - ins) * k, y: oh * 0.04 }, { x: ow, y: oh }, { x: 0, y: oh }]
	) as Homography;
	const inv = invertH(fwd);
	return {
		map: (p) => applyH(fwd, p),
		shoot(src) {
			const sctx = src.getContext('2d');
			const sd = sctx.getImageData(0, 0, W, H).data;
			const out = createCanvas(ow, oh);
			const octx = out.getContext('2d');
			const img = octx.createImageData(ow, oh);
			const d = img.data;
			for (let y = 0; y < oh; y++) {
				for (let x = 0; x < ow; x++) {
					// supersample 2x2 to avoid aliasing on the downscale
					let r = 0, g = 0, b = 0, n = 0;
					for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
						const q = applyH(inv, { x: x + dx, y: y + dy });
						const sx = Math.floor(q.x), sy = Math.floor(q.y);
						if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
						const i = (sy * W + sx) * 4;
						r += sd[i]; g += sd[i + 1]; b += sd[i + 2]; n++;
					}
					const o = (y * ow + x) * 4;
					d[o] = n ? r / n : 40; d[o + 1] = n ? g / n : 30; d[o + 2] = n ? b / n : 20; d[o + 3] = 255;
				}
			}
			octx.putImageData(img, 0, 0);
			return out;
		}
	};
}

export const SPECS: SceneSpec[] = [
	{
		name: 'sample-4x4',
		rows: 4,
		cols: 4,
		cell: 150,
		seed: 20261104,
		width: 2048,
		height: 1536,
		scatter: [30, 30, 1290, 1506],
		board: { cx: 1680, cy: 768, size: 690, tilt: 0.035 }
	},
	{
		name: 'sample-3x4',
		rows: 3,
		cols: 4,
		cell: 160,
		seed: 1104,
		width: 2048,
		height: 1536,
		scatter: [30, 30, 1260, 1506],
		board: { cx: 1660, cy: 768, size: 720, tilt: -0.02 },
		artSeed: 11
	},
	{
		name: 'sample-3x3',
		rows: 3,
		cols: 3,
		cell: 180,
		seed: 77,
		width: 2048,
		height: 1536,
		scatter: [30, 30, 1240, 1506],
		board: { cx: 1650, cy: 768, size: 640, tilt: 0 },
		artSeed: 3
	},
	{
		// closer to a phone photo of a real puzzle: see `realism`
		name: 'hard-4x6',
		rows: 4,
		cols: 6,
		cell: 150,
		seed: 4242,
		width: 2048,
		height: 1536,
		scatter: [20, 20, 2028, 1516],
		board: { cx: -2000, cy: -2000, size: 10, tilt: 0 },
		artSeed: 21,
		realism: { cornerRadius: 9, tabVariation: 0.3, jitter: 0.06, keystone: 0.06, outWidth: 1448 }
	}
];

const root = join(import.meta.dirname, '../../fixtures');
const wanted = process.argv.slice(2);

for (const spec of SPECS) {
	if (wanted.length && !wanted.includes(spec.name)) continue;
	const dir = join(root, spec.name);
	mkdirSync(dir, { recursive: true });
	const scene = layoutScene(spec);
	const cam = camera(spec);
	writeFileSync(join(dir, 'photo.jpg'), cam.shoot(renderScene(scene)).toBuffer('image/jpeg', 88));
	writeFileSync(
		join(dir, 'background.jpg'),
		cam.shoot(renderScene(scene, { poses: scene.poses.map(() => null) })).toBuffer('image/jpeg', 88)
	);
	writeFileSync(join(dir, 'art.png'), scene.art.toBuffer('image/png'));
	// Two "after" photos: first piece placed correctly, and first piece placed in the wrong cell.
	const first = 0;
	const correct = scene.poses.map((p, i) => (i === first ? boardPose(scene, i) : p));
	writeFileSync(join(dir, 'after-correct.jpg'), cam.shoot(renderScene(scene, { poses: correct, seedOffset: 1 })).toBuffer('image/jpeg', 92));
	const wrongCell = scene.pieces.findIndex((p) => p.row === spec.rows - 1 && p.col === spec.cols - 1);
	const wrong = scene.poses.map((p, i) => (i === first ? boardPose(scene, wrongCell) : p));
	writeFileSync(join(dir, 'after-wrong.jpg'), cam.shoot(renderScene(scene, { poses: wrong, seedOffset: 2 })).toBuffer('image/jpeg', 92));

	const gt = {
		name: spec.name,
		rows: spec.rows,
		cols: spec.cols,
		// side length in photo pixels (the warp scales the scene)
		cell: spec.realism ? (spec.cell * spec.realism.outWidth) / spec.width : spec.cell,
		width: spec.realism ? spec.realism.outWidth : spec.width,
		height: spec.realism ? Math.round(spec.height * (spec.realism.outWidth / spec.width)) : spec.height,
		boardQuad: scene.boardQuad.map(cam.map),
		pieces: scene.pieces.map((piece, i) => {
			const pose = scene.poses[i];
			const center = pieceCenter(piece, spec.cell);
			return {
				index: i,
				row: piece.row,
				col: piece.col,
				sides: piece.sides,
				pose,
				center: cam.map({ x: pose.x, y: pose.y }),
				// true (sharp) base corners, even when the cut is rounded
				corners: [
					{ x: piece.col * spec.cell, y: piece.row * spec.cell },
					{ x: (piece.col + 1) * spec.cell, y: piece.row * spec.cell },
					{ x: (piece.col + 1) * spec.cell, y: (piece.row + 1) * spec.cell },
					{ x: piece.col * spec.cell, y: (piece.row + 1) * spec.cell }
				].map((p) => cam.map(transform(p, center, pose))),
				outline: piece.outline.map((p) => cam.map(transform(p, center, pose)))
			};
		})
	};
	writeFileSync(join(dir, 'gt.json'), JSON.stringify(gt));
	console.log(`wrote ${dir}`);
}
