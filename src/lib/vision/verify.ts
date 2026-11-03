import { applyH, applySim, pieceToGrid, type Homography } from './homography';
import type { MaskROI, Pt, RGBAImage } from './types';

export type VerifyStatus = 'verified' | 'needs_confirmation' | 'not_detected';

export interface VerifyEvidence {
	sourceVacated: boolean;
	/** Best normalised cross-correlation of the expected piece in the target cell, -1..1. */
	targetMatch?: number;
	/** How much the target area changed compared with the first photo, 0..1. */
	targetChanged?: number;
	boardMoved: boolean;
}

export interface VerifyResult {
	status: VerifyStatus;
	reason: string;
	evidence: VerifyEvidence;
}

export interface VerifyInput {
	before: RGBAImage;
	after: RGBAImage;
	mask: MaskROI;
	corners: Pt[];
	row: number;
	col: number;
	rot: number;
	/** grid -> image; omitted in 2D mode */
	board?: Homography;
	/** all piece masks from the first photo, used to find static background */
	allMasks: MaskROI[];
	boardQuad?: Pt[];
}

function gray(img: RGBAImage, x: number, y: number): number {
	const xi = Math.min(img.width - 1, Math.max(0, Math.round(x)));
	const yi = Math.min(img.height - 1, Math.max(0, Math.round(y)));
	const i = (yi * img.width + xi) * 4;
	return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
}

function inside(img: RGBAImage, p: Pt): boolean {
	return p.x >= 0 && p.y >= 0 && p.x < img.width - 1 && p.y < img.height - 1;
}

function ncc(a: number[], b: number[]): number {
	const n = a.length;
	if (n < 20) return 0;
	let ma = 0,
		mb = 0;
	for (let i = 0; i < n; i++) {
		ma += a[i];
		mb += b[i];
	}
	ma /= n;
	mb /= n;
	let num = 0,
		da = 0,
		db = 0;
	for (let i = 0; i < n; i++) {
		const x = a[i] - ma;
		const y = b[i] - mb;
		num += x * y;
		da += x * x;
		db += y * y;
	}
	if (da < 1e-6 || db < 1e-6) return 0;
	return num / Math.sqrt(da * db);
}

function pointInPoly(p: Pt, poly: Pt[]): boolean {
	let c = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i];
		const b = poly[j];
		if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
	}
	return c;
}

/** Sampled piece pixels (photo coordinates) from the first photo. */
function samplePiece(mask: MaskROI, target = 900): Pt[] {
	let count = 0;
	for (let i = 0; i < mask.data.length; i++) count += mask.data[i];
	const step = Math.max(1, Math.floor(Math.sqrt(count / target)));
	const pts: Pt[] = [];
	for (let y = step; y < mask.height - step; y += step) {
		for (let x = step; x < mask.width - step; x += step) {
			// interior only: skip pixels near the boundary, where shadows and misalignment live
			const k = y * mask.width + x;
			if (
				mask.data[k] &&
				mask.data[k - step] &&
				mask.data[k + step] &&
				mask.data[k - step * mask.width] &&
				mask.data[k + step * mask.width]
			)
				pts.push({ x: mask.left + x + 0.5, y: mask.top + y + 0.5 });
		}
	}
	return pts;
}

/** Detects camera movement from background areas that should not change. */
export function cameraMoved(before: RGBAImage, after: RGBAImage, masks: MaskROI[], boardQuad?: Pt[]): boolean {
	if (before.width !== after.width || before.height !== after.height) return true;
	const cell = 24;
	let diffs: number[] = [];
	for (let y = cell; y < before.height - cell; y += cell * 3) {
		for (let x = cell; x < before.width - cell; x += cell * 3) {
			const p = { x, y };
			if (boardQuad && pointInPoly(p, boardQuad)) continue;
			const nearPiece = masks.some(
				(m) => x > m.left - cell * 2 && x < m.left + m.width + cell * 2 && y > m.top - cell * 2 && y < m.top + m.height + cell * 2
			);
			if (nearPiece) continue;
			let sa: number[] = [],
				sb: number[] = [];
			for (let dy = -cell; dy < cell; dy += 4)
				for (let dx = -cell; dx < cell; dx += 4) {
					sa.push(gray(before, x + dx, y + dy));
					sb.push(gray(after, x + dx, y + dy));
				}
			let d = 0;
			for (let i = 0; i < sa.length; i++) d += Math.abs(sa[i] - sb[i]);
			diffs.push(d / sa.length);
			sa = sb = [];
		}
	}
	if (diffs.length < 6) return false;
	diffs = diffs.sort((p, q) => p - q);
	// median background change; textured backgrounds shift a lot when the camera moves
	return diffs[Math.floor(diffs.length / 2)] > 14;
}

export function verifyPlacement(input: VerifyInput): VerifyResult {
	const { before, after, mask } = input;
	const boardMoved = cameraMoved(before, after, input.allMasks, input.boardQuad);
	const pts = samplePiece(mask);
	const orig = pts.map((p) => gray(before, p.x, p.y));

	// Source: did the piece leave its original spot?
	const nowAtSource = pts.map((p) => gray(after, p.x, p.y));
	let mad = 0;
	for (let i = 0; i < pts.length; i++) mad += Math.abs(orig[i] - nowAtSource[i]);
	mad /= Math.max(1, pts.length);
	const sourceNcc = ncc(orig, nowAtSource);
	const sourceVacated = mad > 18 || sourceNcc < 0.35;

	if (boardMoved) {
		return {
			status: 'not_detected',
			reason: 'Your camera seems to have moved. Recalibrate or confirm by hand.',
			evidence: { sourceVacated, boardMoved }
		};
	}

	if (!input.board) {
		return sourceVacated
			? {
					status: 'needs_confirmation',
					reason: 'The piece has left its spot. Without an assembly area we cannot see where it went.',
					evidence: { sourceVacated, boardMoved }
				}
			: {
					status: 'not_detected',
					reason: 'The piece still seems to be in its original spot.',
					evidence: { sourceVacated, boardMoved }
				};
	}

	// Target: does the expected piece appear in its cell? Search small offsets
	// and rotations around the ideal pose, because hands are not precise.
	const sim = pieceToGrid(input.corners, input.row, input.col, input.rot);
	const gridPts = pts.map((p) => applySim(sim, p));
	const cx = input.col + 0.5;
	const cy = input.row + 0.5;
	let best = -1;
	let beforeAtBest: number[] = [];
	let afterAtBest: number[] = [];
	for (const ang of [-0.1, -0.05, 0, 0.05, 0.1]) {
		const c = Math.cos(ang);
		const s = Math.sin(ang);
		for (let ty = -0.16; ty <= 0.161; ty += 0.04) {
			for (let tx = -0.16; tx <= 0.161; tx += 0.04) {
				const a: number[] = [];
				const b: number[] = [];
				for (let i = 0; i < gridPts.length; i += 2) {
					const g = gridPts[i];
					const dx = g.x - cx;
					const dy = g.y - cy;
					const q = applyH(input.board, { x: cx + c * dx - s * dy + tx, y: cy + s * dx + c * dy + ty });
					if (!inside(after, q)) continue;
					a.push(orig[i]);
					b.push(gray(after, q.x, q.y));
				}
				const v = ncc(a, b);
				if (v > best) {
					best = v;
					afterAtBest = b;
					beforeAtBest = [];
					for (let i = 0; i < gridPts.length; i += 2) {
						const g = gridPts[i];
						const dx = g.x - cx;
						const dy = g.y - cy;
						const q = applyH(input.board, { x: cx + c * dx - s * dy + tx, y: cy + s * dx + c * dy + ty });
						if (inside(before, q)) beforeAtBest.push(gray(before, q.x, q.y));
					}
				}
			}
		}
	}
	let changed = 0;
	const m = Math.min(afterAtBest.length, beforeAtBest.length);
	for (let i = 0; i < m; i++) changed += Math.abs(afterAtBest[i] - beforeAtBest[i]);
	const targetChanged = Math.min(1, changed / Math.max(1, m) / 60);
	const targetMatch = Math.round(best * 100) / 100;
	const evidence = { sourceVacated, targetMatch, targetChanged, boardMoved };

	if (targetMatch >= 0.6 && sourceVacated && targetChanged > 0.2) {
		return { status: 'verified', reason: 'The piece left its spot and its picture lines up in the target cell.', evidence };
	}
	if (targetMatch >= 0.35 || (sourceVacated && targetChanged > 0.2)) {
		return {
			status: 'needs_confirmation',
			reason: 'Looks close, but the photo is not conclusive. Please confirm by hand.',
			evidence
		};
	}
	return {
		status: 'not_detected',
		reason: sourceVacated
			? 'The piece moved, but we could not find it in the target cell.'
			: 'We can’t confirm this placement from the photo.',
		evidence
	};
}
