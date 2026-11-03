import type { PieceGeometry, Placement, Rotation } from './types';

/** Turns a board by `steps` quarter turns (square) or half turns (otherwise), clockwise. */
export function turnPlacements(placements: Placement[], rows: number, cols: number, steps: number): Placement[] {
	const square = rows === cols;
	return placements.map((p) => {
		let { row, col } = p;
		for (let k = 0; k < steps; k++) {
			if (square) [row, col] = [col, rows - 1 - row];
			else [row, col] = [rows - 1 - row, cols - 1 - col];
		}
		return { ...p, row, col, rot: ((p.rot + (square ? 1 : 2) * steps) % 4) as Rotation };
	});
}

/**
 * Every turn of a board is an equally valid answer without a box image. Picks
 * the one that looks upright: puzzle art is usually lighter and bluer at the
 * top (sky) than at the bottom. Returns the number of turns to apply.
 */
export function uprightTurns(placements: Placement[], geoms: PieceGeometry[], rows: number, cols: number): number {
	const tone = geoms.map((g) => {
		let L = 0,
			b = 0,
			n = 0;
		for (const side of g.sides) {
			for (let i = 0; i < side.lab.length; i += 3) {
				L += side.lab[i];
				b += side.lab[i + 2];
				n++;
			}
		}
		return L / n - 1.2 * (b / n);
	});
	let best = 0;
	let bestScore = -Infinity;
	for (let steps = 0; steps < (rows === cols ? 4 : 2); steps++) {
		const placed = turnPlacements(placements, rows, cols, steps);
		const row = (r: number) => placed.filter((p) => p.row === r).reduce((s, p) => s + tone[p.piece], 0) / cols;
		const score = row(0) - row(rows - 1);
		if (score > bestScore + 1e-9) {
			bestScore = score;
			best = steps;
		}
	}
	return best;
}
