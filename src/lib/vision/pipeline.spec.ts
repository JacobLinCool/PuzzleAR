import { describe, expect, it } from 'vitest';
import { masksFromResult, parseSamStream, textStream } from '$lib/sam/masks';
import { analyzeAll } from './analyze';
import { polygonToMask } from './mask';
import { buildMatchTable } from './match';
import { canonicalKey, solve } from './solver';
import { turnPlacements, uprightTurns } from './orient';
import { align, loadGT, loadRGBA, readStream } from './testing';
import type { MaskROI } from './types';

async function runFixture(name: string, source: 'gt' | 'sam') {
	const gt = loadGT(name);
	const img = await loadRGBA(name);
	let masks: MaskROI[];
	if (source === 'gt') masks = gt.pieces.map((p) => polygonToMask(p.outline));
	else masks = masksFromResult(await parseSamStream(textStream(readStream(name)))).map((m) => m.mask);
	const geoms = analyzeAll(img, masks.map((mask) => ({ mask }))).geoms as import('./types').PieceGeometry[];
	const aligned = geoms.map((g) => align(g, gt));
	const t0 = Date.now();
	const table = buildMatchTable(geoms);
	const result = solve({
		rows: gt.rows,
		cols: gt.cols,
		sideTypes: geoms.map((g) => g.sides.map((s) => s.type)),
		table
	});
	const elapsed = Date.now() - t0;
	const truth = new Int16Array(gt.rows * gt.cols);
	aligned.forEach((a, i) => (truth[a.gt.row * gt.cols + a.gt.col] = i * 4 + a.shift));
	const truthKey = canonicalKey(truth, gt.rows, gt.cols);
	const keys = result.ok
		? result.candidates.map((c) => {
				const cells = new Int16Array(gt.rows * gt.cols);
				c.placements.forEach((p) => (cells[p.row * gt.cols + p.col] = p.piece * 4 + p.rot));
				return canonicalKey(cells, gt.rows, gt.cols);
			})
		: [];
	return { gt, geoms, aligned, result, truthKey, keys, elapsed };
}

// hard-4x6: tilted camera, rounded cuts, uneven tabs, wood table, lower resolution
for (const name of ['sample-3x3', 'sample-3x4', 'sample-4x4', 'hard-4x6']) {
	for (const source of ['gt', 'sam'] as const) {
		describe(`${name} (${source} masks)`, async () => {
			const run = await runFixture(name, source);
			it('finds every piece with accurate base corners', () => {
				expect(new Set(run.aligned.map((a) => a.gt.index)).size).toBe(run.gt.pieces.length);
				const worst = Math.max(...run.aligned.map((a) => a.cornerErr));
				expect(worst).toBeLessThan(name.startsWith('hard') ? 0.13 : 0.08);
			});
			it('classifies flat / tab / socket sides', () => {
				let wrong = 0;
				run.geoms.forEach((g, i) => {
					const a = run.aligned[i];
					g.sides.forEach((s, k) => {
						if (s.type !== a.gt.sides[(k + a.shift) % 4]) wrong++;
					});
				});
				expect(wrong).toBe(0);
			});
			it('solves to the ground-truth board within the top 3', () => {
				expect(run.result.ok).toBe(true);
				console.log(name, source, 'solve ms', run.elapsed, 'rank', run.keys.indexOf(run.truthKey));
				expect(run.keys).toContain(run.truthKey);
				if (source === 'gt' && name === 'sample-3x3') expect(run.keys[0]).toBe(run.truthKey);
			});
			it('turns the best board upright', () => {
				if (!run.result.ok) throw new Error('unsolved');
				const c = run.result.candidates[run.keys.indexOf(run.truthKey)];
				const placed = turnPlacements(c.placements, run.gt.rows, run.gt.cols, uprightTurns(c.placements, run.geoms, run.gt.rows, run.gt.cols));
				for (const p of placed) {
					const a = run.aligned[p.piece];
					expect([p.row, p.col, p.rot]).toEqual([a.gt.row, a.gt.col, a.shift]);
				}
			});
		});
	}
}
