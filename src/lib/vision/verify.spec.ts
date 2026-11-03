import { describe, expect, it } from 'vitest';
import { masksFromResult, parseSamStream, textStream } from '$lib/sam/masks';
import { analyzePiece } from './edges';
import { applyH, boardHomography, homographyFromPoints, invertH } from './homography';
import { align, loadGT, loadRGBA, readStream } from './testing';
import { verifyPlacement } from './verify';

describe('homography', () => {
	it('maps the four reference points exactly and inverts', () => {
		const src = [
			{ x: 0, y: 0 },
			{ x: 4, y: 0 },
			{ x: 4, y: 4 },
			{ x: 0, y: 4 }
		];
		const dst = [
			{ x: 100, y: 120 },
			{ x: 520, y: 100 },
			{ x: 560, y: 540 },
			{ x: 90, y: 500 }
		];
		const H = homographyFromPoints(src, dst)!;
		const Hi = invertH(H);
		src.forEach((p, i) => {
			const q = applyH(H, p);
			expect(q.x).toBeCloseTo(dst[i].x, 6);
			expect(q.y).toBeCloseTo(dst[i].y, 6);
			const back = applyH(Hi, q);
			expect(back.x).toBeCloseTo(p.x, 6);
		});
	});
	it('rejects corners tapped out of order', () => {
		const quad = [
			{ x: 0, y: 0 },
			{ x: 100, y: 100 },
			{ x: 100, y: 0 },
			{ x: 0, y: 100 }
		];
		expect(boardHomography(quad, 4, 4)?.valid).toBe(false);
	});
});

describe('placement verification (sample-4x4)', async () => {
	const name = 'sample-4x4';
	const gt = loadGT(name);
	const before = await loadRGBA(name);
	const correct = await loadRGBA(name, 'after-correct.jpg');
	const wrong = await loadRGBA(name, 'after-wrong.jpg');
	const masks = masksFromResult(await parseSamStream(textStream(readStream(name)))).map((m) => m.mask);
	const geoms = masks.map((m) => analyzePiece(before, m));
	const idx = geoms.findIndex((g) => align(g, gt).gt.index === 0);
	const a = align(geoms[idx], gt);
	const board = boardHomography(gt.boardQuad, gt.rows, gt.cols)!.H;
	const base = {
		before,
		mask: masks[idx],
		corners: geoms[idx].corners,
		row: a.gt.row,
		col: a.gt.col,
		rot: a.shift,
		board,
		allMasks: masks,
		boardQuad: gt.boardQuad
	};

	it('verifies a piece placed in the right cell', () => {
		const r = verifyPlacement({ ...base, after: correct });
		console.log('correct', r.evidence);
		expect(r.status).toBe('verified');
	});
	it('never verifies a piece placed in the wrong cell', () => {
		const r = verifyPlacement({ ...base, after: wrong });
		console.log('wrong', r.evidence);
		expect(r.status).not.toBe('verified');
	});
	it('reports nothing when the piece has not moved', () => {
		const r = verifyPlacement({ ...base, after: before });
		expect(r.status).toBe('not_detected');
		expect(r.evidence.sourceVacated).toBe(false);
	});
	it('asks for confirmation in 2D mode', () => {
		const r = verifyPlacement({ ...base, after: correct, board: undefined });
		expect(r.status).toBe('needs_confirmation');
	});
});

describe('outline simplification', () => {
	it('keeps the shape of a closed curve', async () => {
		const { simplify } = await import('./contour');
		const circle = Array.from({ length: 200 }, (_, i) => ({ x: 50 + 40 * Math.cos((i / 200) * Math.PI * 2), y: 50 + 40 * Math.sin((i / 200) * Math.PI * 2) }));
		const out = simplify([...circle, circle[0]], 0.5);
		expect(out.length).toBeGreaterThan(16);
	});
});
