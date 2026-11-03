import {
	decodeMaskToRaster,
	parseImageStream,
	recordsOfKind,
	type ImageSegmentationResult,
	type SegmentationMaskRecord
} from '@meta-sam/parser';
import type { MaskROI } from '$lib/vision/types';
import { sseEvents } from './sse';

export interface SamPiece {
	samObjectId: string;
	confidence?: number;
	mask: MaskROI;
}

/**
 * Converts parsed SAM records into full-frame ROI masks. Each mask raster is
 * H x W and sits at its record's half-open `bounds` inside the frame.
 */
export function masksFromResult(result: ImageSegmentationResult): SamPiece[] {
	// a later mask for the same object replaces the earlier one
	const latest = new Map<string, SegmentationMaskRecord>();
	for (const record of recordsOfKind(result.records, 'mask')) latest.set(record.objectId, record);
	return [...latest.values()].map((record) => ({
		samObjectId: record.objectId,
		confidence: record.confidence,
		mask: maskFromRecord(record)
	}));
}

/** Parses a raw SSE body (live or replayed) into the final SAM result. */
export async function parseSamStream(
	body: ReadableStream<Uint8Array>,
	onSnapshot?: (masks: readonly SegmentationMaskRecord[]) => void
): Promise<ImageSegmentationResult> {
	const parsed = parseImageStream(sseEvents(body) as never);
	for await (const snap of parsed) onSnapshot?.(recordsOfKind(snap.records, 'mask'));
	return parsed.finalResult;
}

/** Decodes one mask record into a full-frame ROI. */
export function maskFromRecord(record: SegmentationMaskRecord): MaskROI {
	return {
		left: record.bounds.left,
		top: record.bounds.top,
		width: record.mask.width,
		height: record.mask.height,
		data: Uint8Array.from(decodeMaskToRaster(record.mask))
	};
}

export function textStream(text: string): ReadableStream<Uint8Array> {
	const bytes = new TextEncoder().encode(text);
	return new ReadableStream({
		start(controller) {
			// replay in chunks so the parser exercises split deltas
			for (let i = 0; i < bytes.length; i += 4096) controller.enqueue(bytes.slice(i, i + 4096));
			controller.close();
		}
	});
}
