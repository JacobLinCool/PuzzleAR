import { analyzePiece, type AnalyzeOptions } from './edges';
import { estimateRectification, type Linear } from './rectify';
import type { MaskROI, PieceGeometry, RGBAImage } from './types';

/**
 * Analyses every piece of a photo. A first pass finds the base quadrilaterals;
 * if they show the camera was tilted, a second pass measures all geometry on
 * foreshortening-corrected contours.
 */
export function analyzeAll(
	img: RGBAImage,
	items: { mask: MaskROI; opts?: AnalyzeOptions }[]
): { geoms: (PieceGeometry | { error: string })[]; rectify: Linear | null } {
	const run = (rectify?: Linear) =>
		items.map((it) => {
			try {
				return analyzePiece(img, it.mask, { ...it.opts, rectify });
			} catch (err) {
				return { error: String((err as Error).message ?? err) };
			}
		});
	const first = run();
	const quads = first.filter((g): g is PieceGeometry => !('error' in g)).map((g) => g.corners);
	const rectify = estimateRectification(quads);
	return { geoms: rectify ? run(rectify) : first, rectify };
}
