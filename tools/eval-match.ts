/** For every true adjacency: rank of the true partner among candidates, and score parts. */
import { masksFromResult, parseSamStream, textStream } from '../src/lib/sam/masks';
import { analyzeAll } from '../src/lib/vision/analyze';
import { buildMatchTable, likelyPairs } from '../src/lib/vision/match';
import { align, loadGT, loadRGBA, readStream } from '../src/lib/vision/testing';
const name = process.argv[2] ?? 'hard-4x6';
const gt = loadGT(name);
const img = await loadRGBA(name);
const masks = masksFromResult(await parseSamStream(textStream(readStream(name)))).map((m) => m.mask);
const geoms = analyzeAll(img, masks.map((mask) => ({ mask }))).geoms as import('../src/lib/vision/types').PieceGeometry[];
const al = geoms.map((g) => align(g, gt));
const t = buildMatchTable(geoms);
const at = (r: number, c: number) => al.findIndex((a) => a.gt.row === r && a.gt.col === c);
// GT side d of piece p corresponds to detected side (d - shift) mod 4
const sideOf = (p: number, d: number) => p * 4 + ((d - al[p].shift + 4) % 4);
const ranks: number[] = [];
const rows: string[] = [];
for (let r = 0; r < gt.rows; r++) for (let c = 0; c < gt.cols; c++) {
	for (const [dr, dc, d] of [[0, 1, 1], [1, 0, 2]] as const) {
		if (r + dr >= gt.rows || c + dc >= gt.cols) continue;
		const a = sideOf(at(r, c), d), b = sideOf(at(r + dr, c + dc), (d + 2) % 4);
		const rank = [...Array(t.n).keys()].filter((j) => Number.isFinite(t.cost[a * t.n + j])).sort((x, y) => t.cost[a * t.n + x] - t.cost[a * t.n + y]).indexOf(b);
		ranks.push(rank);
		const p = t.parts.get(a * t.n + b);
		if (rank !== 0) rows.push(`r${r}c${c}${d === 1 ? '→' : '↓'} rank ${rank} cost ${p?.cost.toFixed(2)} shape ${p?.shape.toFixed(2)} color ${p?.color.toFixed(2)} len ${p?.length.toFixed(3)}`);
	}
}
console.log(`${name}: top1 ${ranks.filter((x) => x === 0).length}/${ranks.length}, top3 ${ranks.filter((x) => x >= 0 && x < 3).length}, missing ${ranks.filter((x) => x < 0).length}`);
console.log(rows.join('\n'));

// precision of the "likely neighbours" list (pairs mode)
const truePairs = new Set<string>();
for (let r = 0; r < gt.rows; r++) for (let c = 0; c < gt.cols; c++) for (const [dr, dc, d] of [[0, 1, 1], [1, 0, 2]] as const) {
	if (r + dr >= gt.rows || c + dc >= gt.cols) continue;
	const a = sideOf(at(r, c), d), b = sideOf(at(r + dr, c + dc), (d + 2) % 4);
	truePairs.add(a < b ? `${a}-${b}` : `${b}-${a}`);
}
const pairs = likelyPairs(t);
const mutual = pairs.filter((p) => p.mutual);
const strong = mutual.filter((p) => p.margin > 0.06);
const hit = (ps: typeof pairs) => ps.filter((p) => truePairs.has(`${p.a}-${p.b}`)).length;
console.log(`pairs: mutual ${hit(mutual)}/${mutual.length} correct, strong ${hit(strong)}/${strong.length}, top10 ${hit(pairs.slice(0, 10))}/10`);
