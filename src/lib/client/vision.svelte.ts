import type { AnalyzeOptions } from '$lib/vision/edges';
import type { Linear } from '$lib/vision/rectify';
import type { SolveResult } from '$lib/vision/solver';
import type { HumanConstraint, PieceGeometry, Pin, RGBAImage } from '$lib/vision/types';
import type { PairCandidate } from '$lib/vision/match';
import type { VerifyResult } from '$lib/vision/verify';
import type { MaskRecord } from '$lib/shared/doc';
import type { VisionRequest } from './vision.worker';

export interface RankedSide {
	side: number;
	cost: number;
	shape?: number;
	color?: number;
	length?: number;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const loaded = new Set<string>();

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
			const p = pending.get(e.data.id);
			if (!p) return;
			pending.delete(e.data.id);
			if (e.data.error) p.reject(new Error(e.data.error));
			else p.resolve(e.data.result);
		};
	}
	return worker;
}

function call<T>(req: VisionRequest, transfer: Transferable[] = []): Promise<T> {
	const id = ++seq;
	return new Promise<T>((resolve, reject) => {
		pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
		// reactive proxies cannot cross into the worker; send plain data
		getWorker().postMessage({ id, req: req.type === 'image' ? req : $state.snapshot(req) }, transfer);
	});
}

export async function loadImage(key: string, image: RGBAImage) {
	if (loaded.has(key)) return;
	// copy so the caller keeps its pixels
	const copy = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
	await call({ type: 'image', key, image: copy }, [copy.data.buffer]);
	loaded.add(key);
}

export function analyze(imageKey: string, pieces: { key: string; mask: MaskRecord; opts: AnalyzeOptions }[], rectify?: Linear | null) {
	return call<{ key: string; geom?: PieceGeometry; error?: string }[]>({ type: 'analyze', imageKey, pieces, rectify });
}

/** Analyses a whole photo, estimating the camera tilt correction from all pieces. */
export function analyzeAll(imageKey: string, pieces: { key: string; mask: MaskRecord; opts: AnalyzeOptions }[]) {
	return call<{ rectify: Linear | null; results: { key: string; geom?: PieceGeometry; error?: string }[] }>({ type: 'analyzeAll', imageKey, pieces });
}

export function runSolve(req: {
	tableKey: string;
	geoms: PieceGeometry[];
	rows: number;
	cols: number;
	constraints: HumanConstraint[];
	pins: Pin[];
}) {
	return call<{ result: SolveResult; top: RankedSide[][]; parts: Record<string, { shape: number; color: number; length: number; cost: number }> }>({ type: 'solve', ...req });
}

export function verify(req: Omit<Extract<VisionRequest, { type: 'verify' }>, 'type'>) {
	return call<VerifyResult>({ type: 'verify', ...req });
}

export function findPairs(req: { tableKey: string; geoms: PieceGeometry[]; forbidden: string[] }) {
	return call<PairCandidate[]>({ type: 'pairs', ...req });
}
