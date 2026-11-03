/// <reference lib="webworker" />
/**
 * Off-main-thread vision: geometry extraction, edge matching, solving and
 * placement verification. Images are sent once and cached by key.
 */
import { analyzeAll } from '$lib/vision/analyze';
import { analyzePiece, type AnalyzeOptions } from '$lib/vision/edges';
import type { Linear } from '$lib/vision/rectify';
import { decodeRLE } from '$lib/vision/mask';
import { buildMatchTable, likelyPairs, type MatchTable } from '$lib/vision/match';
import { solve, type SolveInput } from '$lib/vision/solver';
import type { HumanConstraint, MaskROI, PieceGeometry, Pin, RGBAImage } from '$lib/vision/types';
import { verifyPlacement } from '$lib/vision/verify';
import type { MaskRecord } from '$lib/shared/doc';

const images = new Map<string, RGBAImage>();
let lastTable: { key: string; table: MatchTable } | null = null;

export type VisionRequest =
	| { type: 'image'; key: string; image: RGBAImage }
	| { type: 'analyze'; imageKey: string; pieces: { key: string; mask: MaskRecord; opts: AnalyzeOptions }[]; rectify?: Linear | null }
	| { type: 'analyzeAll'; imageKey: string; pieces: { key: string; mask: MaskRecord; opts: AnalyzeOptions }[] }
	| {
			type: 'solve';
			tableKey: string;
			geoms: PieceGeometry[];
			rows: number;
			cols: number;
			constraints: HumanConstraint[];
			pins: Pin[];
	  }
	| { type: 'pairs'; tableKey: string; geoms: PieceGeometry[]; forbidden: string[] }
	| {
			type: 'verify';
			beforeKey: string;
			afterKey: string;
			mask: MaskRecord;
			corners: PieceGeometry['corners'];
			row: number;
			col: number;
			rot: number;
			board?: number[];
			allMasks: MaskRecord[];
			boardQuad?: { x: number; y: number }[];
	  };

function toROI(m: MaskRecord): MaskROI {
	return decodeRLE(m.rle, m);
}

function handle(req: VisionRequest) {
	switch (req.type) {
		case 'image':
			images.set(req.key, req.image);
			return true;
		case 'analyze': {
			const img = images.get(req.imageKey);
			if (!img) throw new Error('IMAGE_NOT_LOADED');
			return req.pieces.map((p) => {
				try {
					return { key: p.key, geom: analyzePiece(img, toROI(p.mask), { ...p.opts, rectify: req.rectify ?? undefined }) };
				} catch (err) {
					return { key: p.key, error: String((err as Error).message ?? err) };
				}
			});
		}
		case 'analyzeAll': {
			const img = images.get(req.imageKey);
			if (!img) throw new Error('IMAGE_NOT_LOADED');
			const { geoms, rectify } = analyzeAll(img, req.pieces.map((p) => ({ mask: toROI(p.mask), opts: p.opts })));
			return {
				rectify,
				results: geoms.map((g, i) => ('error' in g ? { key: req.pieces[i].key, error: g.error } : { key: req.pieces[i].key, geom: g }))
			};
		}
		case 'solve': {
			if (!lastTable || lastTable.key !== req.tableKey) {
				lastTable = { key: req.tableKey, table: buildMatchTable(req.geoms) };
			}
			const input: SolveInput = {
				rows: req.rows,
				cols: req.cols,
				sideTypes: req.geoms.map((g) => g.sides.map((s) => s.type)),
				table: lastTable.table,
				constraints: req.constraints,
				pins: req.pins
			};
			const result = solve(input);
			// expose per-side ranked candidates for the "Confirm a fit" panel
			const table = lastTable.table;
			const top = table.top.map((row, i) =>
				row.slice(0, 4).map((j) => ({ side: j, cost: table.cost[i * table.n + j], ...table.parts.get(i * table.n + j) }))
			);
			// score breakdown for every edge used by a candidate board
			const parts: Record<string, { shape: number; color: number; length: number; cost: number }> = {};
			if (result.ok) {
				for (const c of result.candidates) {
					for (const e of c.edges) {
						const ia = e.a * 4 + e.sideA;
						const ib = e.b * 4 + e.sideB;
						const part = table.parts.get(ia * table.n + ib);
						if (part) parts[`${ia}-${ib}`] = part;
					}
				}
			}
			return { result, top, parts };
		}
		case 'pairs': {
			if (!lastTable || lastTable.key !== req.tableKey) {
				lastTable = { key: req.tableKey, table: buildMatchTable(req.geoms) };
			}
			return likelyPairs(lastTable.table, new Set(req.forbidden));
		}
		case 'verify': {
			const before = images.get(req.beforeKey);
			const after = images.get(req.afterKey);
			if (!before || !after) throw new Error('IMAGE_NOT_LOADED');
			return verifyPlacement({
				before,
				after,
				mask: toROI(req.mask),
				corners: req.corners,
				row: req.row,
				col: req.col,
				rot: req.rot,
				board: req.board,
				allMasks: req.allMasks.map(toROI),
				boardQuad: req.boardQuad
			});
		}
	}
}

self.onmessage = (e: MessageEvent<{ id: number; req: VisionRequest }>) => {
	const { id, req } = e.data;
	try {
		const result = handle(req);
		(self as unknown as Worker).postMessage({ id, result });
	} catch (err) {
		(self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message ?? err) });
	}
};
