/** Turning SAM responses into app pieces, plus quality checks. */
import type { PromptObject, SegmentationMaskRecord } from '@meta-sam/parser';
import { masksFromResult, parseSamStream, textStream, type SamPiece } from '$lib/sam/masks';
import type { MaskRecord, PieceRecord, SegmentRecord, WorkspaceDoc } from '$lib/shared/doc';
import { encodeRLE, maskArea, maskIoU, decodeRLE } from '$lib/vision/mask';
import type { MaskROI } from '$lib/vision/types';
import { ApiError, api, CLIENT_ERRORS } from './api';

export type SegmentStage = 'uploading' | 'finding' | 'preparing';

export function toRecord(mask: MaskROI): MaskRecord {
	return { left: mask.left, top: mask.top, width: mask.width, height: mask.height, rle: encodeRLE(mask) };
}

export interface SegmentOutcome {
	pieces: SamPiece[];
	record: SegmentRecord;
}

export type OnMasks = (masks: readonly SegmentationMaskRecord[]) => void;

async function finish(res: Response | ReadableStream<Uint8Array>, onMasks: OnMasks) {
	const body = res instanceof Response ? res.body! : res;
	const result = await parseSamStream(body, onMasks);
	if (result.outcome.status !== 'completed') throw new ApiError('SAM_INCOMPLETE', CLIENT_ERRORS.SAM_INCOMPLETE, 0, true);
	return masksFromResult(result);
}

/** Whole-photo concept segmentation (live API call through the Worker). */
export async function segmentLive(sessionId: string, mediaId: string, prompt: string, onMasks: OnMasks, signal?: AbortSignal): Promise<SegmentOutcome> {
	const res = await api.sam(sessionId, 'segment', { mediaId, prompt }, signal);
	const pieces = await finish(res, onMasks);
	return {
		pieces,
		record: {
			requestId: res.headers.get('x-puzzlear-request-id') ?? undefined,
			providerRequestId: res.headers.get('x-provider-request-id') || undefined,
			prompt,
			count: pieces.length,
			at: Date.now(),
			preprocessed: false
		}
	};
}

/** Replays a stored real SAM response for the sample session. */
export async function segmentReplay(streamUrl: string, prompt: string, onMasks: OnMasks): Promise<SegmentOutcome> {
	const text = await (await fetch(streamUrl)).text();
	const pieces = await finish(textStream(text), onMasks);
	return { pieces, record: { prompt, count: pieces.length, at: Date.now(), preprocessed: true } };
}

/** Box / point refinement; returns masks keyed by the object ids we sent. */
export async function refine(sessionId: string, mediaId: string, objects: PromptObject[]): Promise<SamPiece[]> {
	const res = await api.sam(sessionId, 'refine', { mediaId, objects });
	return finish(res, () => {});
}

/** Orders pieces top-to-bottom, left-to-right so labels read naturally on the photo. */
function readingOrder(pieces: SamPiece[]): SamPiece[] {
	const centre = (p: SamPiece) => ({ x: p.mask.left + p.mask.width / 2, y: p.mask.top + p.mask.height / 2 });
	const med = pieces.map((p) => p.mask.height).sort((a, b) => a - b)[Math.floor(pieces.length / 2)] ?? 100;
	return [...pieces].sort((a, b) => {
		const ca = centre(a);
		const cb = centre(b);
		const rowA = Math.round(ca.y / (med * 1.2));
		const rowB = Math.round(cb.y / (med * 1.2));
		return rowA - rowB || ca.x - cb.x;
	});
}

export function newPieceRecords(pieces: SamPiece[], startLabel: number, origin: PieceRecord['origin']) {
	const records: PieceRecord[] = [];
	const masks: Record<string, MaskRecord> = {};
	readingOrder(pieces).forEach((p, i) => {
		const id = crypto.randomUUID();
		const maskKey = `${id}@1`;
		masks[maskKey] = toRecord(p.mask);
		records.push({
			id,
			label: startLabel + i,
			origin,
			samObjectId: p.samObjectId,
			confidence: p.confidence,
			status: 'accepted',
			maskKey,
			version: 1
		});
	});
	return { records, masks };
}

export interface MaskIssue {
	code: 'small' | 'large' | 'border' | 'overlap' | 'confidence';
	message: string;
	action: string;
}

/** Mask-level checks (geometry-level checks come from analyzePiece). */
export function maskIssues(doc: WorkspaceDoc, pieces: PieceRecord[]): Map<string, MaskIssue[]> {
	const out = new Map<string, MaskIssue[]>();
	const rois = new Map(pieces.map((p) => [p.id, decodeRLE(doc.masks[p.maskKey].rle, doc.masks[p.maskKey])]));
	const areas = pieces.map((p) => maskArea(rois.get(p.id)!)).sort((a, b) => a - b);
	const median = areas[Math.floor(areas.length / 2)] ?? 1;
	const W = doc.photo?.width ?? Infinity;
	const H = doc.photo?.height ?? Infinity;
	for (const p of pieces) {
		const issues: MaskIssue[] = [];
		const m = rois.get(p.id)!;
		const area = maskArea(m);
		if (pieces.length >= 4 && area < median * 0.45) {
			issues.push({ code: 'small', message: 'Much smaller than the other pieces; it may be a partial mask or not a piece.', action: 'Edit the mask or remove it' });
		}
		if (pieces.length >= 4 && area > median * 1.8) {
			issues.push({ code: 'large', message: 'Much larger than the others; two pieces may be touching.', action: 'Separate them and retake, or remove it and add each piece' });
		}
		if (m.left <= 1 || m.top <= 1 || m.left + m.width >= W - 1 || m.top + m.height >= H - 1) {
			issues.push({ code: 'border', message: 'Touches the photo edge, so part of it may be cut off.', action: 'Retake with the whole piece in frame' });
		}
		if (p.confidence !== undefined && p.confidence < 0.5) {
			issues.push({ code: 'confidence', message: 'The scanner was unsure about this one.', action: 'Check it, or remove it if it is not a piece' });
		}
		for (const q of pieces) {
			if (q.id === p.id) continue;
			const a = rois.get(q.id)!;
			if (a.left > m.left + m.width || m.left > a.left + a.width || a.top > m.top + m.height || m.top > a.top + a.height) continue;
			if (maskIoU(m, a) > 0.15) {
				issues.push({ code: 'overlap', message: 'Overlaps another mask.', action: 'Remove the duplicate' });
				break;
			}
		}
		out.set(p.id, issues);
	}
	return out;
}
