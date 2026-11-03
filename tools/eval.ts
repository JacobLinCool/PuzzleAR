/**
 * Accuracy report on a fixture: corner error, side-type mistakes and solver rank,
 * for ground-truth masks and for the stored SAM masks.
 * Usage: pnpm tsx tools/eval.ts hard-4x6 [gt|sam]
 */
import { masksFromResult, parseSamStream, textStream } from '../src/lib/sam/masks';
import { analyzeAll } from '../src/lib/vision/analyze';
import { polygonToMask } from '../src/lib/vision/mask';
import { buildMatchTable } from '../src/lib/vision/match';
import { canonicalKey, solve } from '../src/lib/vision/solver';
import { align, loadGT, loadRGBA, readStream } from '../src/lib/vision/testing';

const name = process.argv[2] ?? 'hard-4x6';
const sources = process.argv[3] ? [process.argv[3]] : ['gt', 'sam'];
const gt = loadGT(name);
const img = await loadRGBA(name);
for (const source of sources) {
	const masks = source === 'gt' ? gt.pieces.map((p) => polygonToMask(p.outline)) : masksFromResult(await parseSamStream(textStream(readStream(name)))).map((m) => m.mask);
	const geoms = analyzeAll(img, masks.map((mask) => ({ mask }))).geoms as import('../src/lib/vision/types').PieceGeometry[];
	const al = geoms.map((g) => align(g, gt));
	let badCorners = 0, wrongSides = 0, unknown = 0;
	const errs: number[] = [];
	geoms.forEach((g, i) => {
		const a = al[i];
		errs.push(a.cornerErr);
		if (a.cornerErr > 0.08) badCorners++;
		g.sides.forEach((s, k) => {
			if (s.type === 'unknown') unknown++;
			else if (s.type !== a.gt.sides[(k + a.shift) % 4]) wrongSides++;
		});
	});
	const t0 = Date.now();
	const res = solve({ rows: gt.rows, cols: gt.cols, sideTypes: geoms.map((g) => g.sides.map((s) => s.type)), table: buildMatchTable(geoms) });
	const truth = new Int16Array(gt.rows * gt.cols);
	al.forEach((a, i) => (truth[a.gt.row * gt.cols + a.gt.col] = i * 4 + a.shift));
	const tk = canonicalKey(truth, gt.rows, gt.cols);
	let rank = -1, correctCells = 0;
	if (res.ok) {
		res.candidates.forEach((c, k) => {
			const cells = new Int16Array(gt.rows * gt.cols);
			c.placements.forEach((p) => (cells[p.row * gt.cols + p.col] = p.piece * 4 + p.rot));
			if (canonicalKey(cells, gt.rows, gt.cols) === tk && rank < 0) rank = k;
		});
		// best-turn cell agreement of the top candidate
		const best = res.candidates[0];
		for (const turn of gt.rows === gt.cols ? [0, 1, 2, 3] : [0, 1]) {
			let ok = 0;
			for (const p of best.placements) {
				let r = p.row, c = p.col;
				for (let k = 0; k < turn; k++) [r, c] = gt.rows === gt.cols ? [c, gt.rows - 1 - r] : [gt.rows - 1 - r, gt.cols - 1 - c];
				if (al[p.piece].gt.row === r && al[p.piece].gt.col === c) ok++;
			}
			correctCells = Math.max(correctCells, ok);
		}
	}
	errs.sort((a, b) => a - b);
	console.log(
		`${name} [${source}] pieces ${geoms.length} | corner err median ${errs[Math.floor(errs.length / 2)].toFixed(3)} max ${errs.at(-1)!.toFixed(3)} | bad corners ${badCorners} | wrong sides ${wrongSides} unknown ${unknown} | review ${geoms.filter((g) => g.issues.length).length} | solve ${res.ok ? `rank ${rank}, top board ${correctCells}/${gt.rows * gt.cols} cells${res.relaxed ? ' (relaxed)' : ''}` : res.code} ${Date.now() - t0}ms`
	);
}
