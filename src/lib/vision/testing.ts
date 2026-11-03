/** Fixture helpers shared by the vision tests (Node only). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { PieceGeometry, Pt, RGBAImage } from './types';

export interface GroundTruth {
	name: string;
	rows: number;
	cols: number;
	cell: number;
	boardQuad: Pt[];
	pieces: {
		index: number;
		row: number;
		col: number;
		sides: string[];
		center: Pt;
		corners: Pt[];
		outline: Pt[];
	}[];
}

export const FIXTURES = join(import.meta.dirname, '../../../fixtures');

export function loadGT(name: string): GroundTruth {
	return JSON.parse(readFileSync(join(FIXTURES, name, 'gt.json'), 'utf8'));
}

export async function loadRGBA(name: string, file = 'photo.jpg'): Promise<RGBAImage> {
	const img = await loadImage(readFileSync(join(FIXTURES, name, file)));
	const canvas = createCanvas(img.width, img.height);
	const ctx = canvas.getContext('2d');
	ctx.drawImage(img, 0, 0);
	const data = ctx.getImageData(0, 0, img.width, img.height);
	return { width: img.width, height: img.height, data: data.data };
}

export function readStream(name: string): string {
	return readFileSync(join(FIXTURES, name, 'sam-stream.txt'), 'utf8');
}

export interface Aligned {
	gt: GroundTruth['pieces'][number];
	/** detected corner k corresponds to GT corner (k + shift) % 4 */
	shift: number;
	cornerErr: number;
}

export function align(geom: PieceGeometry, gt: GroundTruth): Aligned {
	const piece = gt.pieces.reduce((best, p) =>
		Math.hypot(p.center.x - geom.centroid.x, p.center.y - geom.centroid.y) <
		Math.hypot(best.center.x - geom.centroid.x, best.center.y - geom.centroid.y)
			? p
			: best
	);
	let bestShift = 0;
	let bestErr = Infinity;
	for (let s = 0; s < 4; s++) {
		let err = 0;
		for (let k = 0; k < 4; k++) {
			const a = geom.corners[k];
			const b = piece.corners[(k + s) % 4];
			err = Math.max(err, Math.hypot(a.x - b.x, a.y - b.y));
		}
		if (err < bestErr) {
			bestErr = err;
			bestShift = s;
		}
	}
	return { gt: piece, shift: bestShift, cornerErr: bestErr / gt.cell };
}

