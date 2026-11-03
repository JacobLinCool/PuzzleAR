/**
 * Sample session only: builds the "new photo" a fixed camera would take after
 * the person moves pieces, by compositing the real cutouts onto the empty-table
 * plate. The UI labels these photos as simulated.
 */
import type { CandidatePlacement, MaskRecord } from '$lib/shared/doc';
import type { Homography } from '$lib/vision/homography';
import type { PieceGeometry, RGBAImage } from '$lib/vision/types';
import { ghostMatrix } from './render';

export interface SimPiece {
	cutout: HTMLCanvasElement;
	mask: MaskRecord;
	geom: PieceGeometry;
	/** Where the piece now sits on the board, or null when still in its spot. */
	placedAt: CandidatePlacement | null;
}

let plate: ImageBitmap | null = null;

export async function simulatePhoto(plateUrl: string, width: number, height: number, pieces: SimPiece[], H: Homography): Promise<{ pixels: RGBAImage; url: string }> {
	if (!plate) plate = await createImageBitmap(await (await fetch(plateUrl)).blob());
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	ctx.drawImage(plate, 0, 0, width, height);
	ctx.shadowColor = 'rgba(0,0,0,0.45)';
	ctx.shadowBlur = 8;
	ctx.shadowOffsetX = 2;
	ctx.shadowOffsetY = 4;
	for (const p of pieces) {
		ctx.save();
		if (p.placedAt) {
			// a hand is never exact: a small, deterministic nudge
			const m = ghostMatrix(H, p.geom, p.placedAt);
			const j = ((p.mask.left * 7 + p.mask.top * 13) % 7) - 3;
			ctx.setTransform(new DOMMatrix().translate(j * 0.8, -j * 0.6).multiply(m));
		}
		ctx.drawImage(p.cutout, p.mask.left, p.mask.top);
		ctx.restore();
	}
	const data = ctx.getImageData(0, 0, width, height);
	return { pixels: { width, height, data: data.data }, url: canvas.toDataURL('image/jpeg', 0.85) };
}
