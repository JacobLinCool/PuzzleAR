/**
 * The workspace document: everything a session knows besides the photo bytes
 * and raw SAM streams (kept in R2). Shared by the browser and the Worker; the
 * Worker validates every write with `validateDoc` before storing it.
 */
import type { Pt, SideType } from '$lib/vision/types';

export type SessionState =
	| 'NEW'
	| 'PHOTO_READY'
	| 'SEGMENTING'
	| 'REVIEW'
	| 'SOLVING'
	| 'SOLUTION_READY'
	| 'GUIDING'
	| 'COMPLETED'
	| 'ERROR_RECOVERABLE';

export type SessionMode = 'camera' | 'upload' | 'demo';

export interface MaskRecord {
	left: number;
	top: number;
	width: number;
	height: number;
	/** Row-major run lengths, starting with a background run. */
	rle: number[];
}

export interface PieceRecord {
	id: string;
	/** Stable display number (#01...). */
	label: number;
	origin: 'segment' | 'refine';
	samObjectId?: string;
	confidence?: number;
	status: 'accepted' | 'needs_review' | 'removed';
	/** Key into doc.masks (`<id>@<version>`). */
	maskKey: string;
	version: number;
	/** Manual base corners (full-frame), clockwise. */
	corners?: [Pt, Pt, Pt, Pt];
	sideTypes?: Partial<Record<number, SideType>>;
}

export interface PhotoRecord {
	mediaId: string;
	/** Same-origin URL; private media is served only with the session cookie. */
	url: string;
	width: number;
	height: number;
	source: 'camera' | 'upload' | 'sample';
	warnings: string[];
}

export interface SegmentRecord {
	requestId?: string;
	providerRequestId?: string;
	prompt: string;
	count: number;
	at: number;
	/** True when replayed from a stored response instead of a live API call. */
	preprocessed: boolean;
}

export interface ConstraintRecord {
	id: string;
	type: 'fits' | 'doesnt_fit';
	pieceA: string;
	sideA: number;
	pieceB: string;
	sideB: number;
	at: number;
}

export interface CandidatePlacement {
	pieceId: string;
	row: number;
	col: number;
	rot: 0 | 1 | 2 | 3;
}

export interface CandidateEdge {
	a: string;
	sideA: number;
	b: string;
	sideB: number;
	confidence: 'strong' | 'check' | 'confirmed';
	reason: string;
}

export interface SolutionRecord {
	id: string;
	/** Piece-set fingerprint the solution was computed from. */
	basis: string;
	rows: number;
	cols: number;
	createdAt: number;
	relaxed: boolean;
	timedOut: boolean;
	candidates: { objective: number; placements: CandidatePlacement[]; edges: CandidateEdge[] }[];
	/** Normalised score parts per edge key `pieceA:side|pieceB:side` (ranking costs, 1 = typical). */
	scores?: Record<string, { shape: number; color: number; length: number }>;
}

export const edgeKey = (a: string, sa: number, b: string, sb: number) =>
	a < b || (a === b && sa < sb) ? `${a}:${sa}|${b}:${sb}` : `${b}:${sb}|${a}:${sa}`;

export interface PlacementRecord {
	id: string;
	pieceId: string;
	row: number;
	col: number;
	rot: 0 | 1 | 2 | 3;
	source: 'vision' | 'manual';
	evidence?: { sourceVacated?: boolean; targetMatch?: number; boardMoved?: boolean };
	at: number;
}

export interface Snapshot {
	label: string;
	at: number;
	state: SessionState;
	pieces: PieceRecord[];
	grid?: { rows: number; cols: number };
	constraints: ConstraintRecord[];
	active?: { solutionId: string; index: number };
	boardQuad?: Pt[];
	placements: PlacementRecord[];
	skipped: string[];
}

export interface WorkspaceDoc {
	v: 1;
	state: SessionState;
	mode: SessionMode;
	photo?: PhotoRecord;
	sample?: { name: string; boardQuad?: Pt[] };
	segment?: SegmentRecord;
	pieces: PieceRecord[];
	masks: Record<string, MaskRecord>;
	grid?: { rows: number; cols: number };
	constraints: ConstraintRecord[];
	solutions: SolutionRecord[];
	active?: { solutionId: string; index: number };
	boardQuad?: Pt[];
	placements: PlacementRecord[];
	skipped: string[];
	startedAt?: number;
	guideStartedAt?: number;
	completedAt?: number;
	history: { undo: Snapshot[]; redo: Snapshot[] };
}

export const HISTORY_LIMIT = 40;
export const MAX_DOC_BYTES = 1_500_000;

export function emptyDoc(mode: SessionMode): WorkspaceDoc {
	return {
		v: 1,
		state: 'NEW',
		mode,
		pieces: [],
		masks: {},
		constraints: [],
		solutions: [],
		placements: [],
		skipped: [],
		history: { undo: [], redo: [] }
	};
}

export function snapshotOf(doc: WorkspaceDoc, label: string): Snapshot {
	return structuredClone({
		label,
		at: Date.now(),
		state: doc.state,
		pieces: doc.pieces,
		grid: doc.grid,
		constraints: doc.constraints,
		active: doc.active,
		boardQuad: doc.boardQuad,
		placements: doc.placements,
		skipped: doc.skipped
	});
}

export function restoreSnapshot(doc: WorkspaceDoc, s: Snapshot): void {
	doc.state = s.state;
	doc.pieces = structuredClone(s.pieces);
	doc.grid = s.grid;
	doc.constraints = structuredClone(s.constraints);
	doc.active = s.active;
	doc.boardQuad = s.boardQuad;
	doc.placements = structuredClone(s.placements);
	doc.skipped = [...s.skipped];
}

export function activePieces(doc: WorkspaceDoc): PieceRecord[] {
	return doc.pieces.filter((p) => p.status !== 'removed');
}

export function activeCandidate(doc: WorkspaceDoc) {
	if (!doc.active) return undefined;
	const sol = doc.solutions.find((s) => s.id === doc.active!.solutionId);
	const cand = sol?.candidates[doc.active.index];
	return sol && cand ? { solution: sol, candidate: cand } : undefined;
}

/** Fingerprint of the inputs a solution depends on, so stale solutions are detectable. */
export function solveBasis(doc: WorkspaceDoc): string {
	return activePieces(doc)
		.map((p) => `${p.id}:${p.version}:${JSON.stringify(p.corners ?? '')}:${JSON.stringify(p.sideTypes ?? '')}`)
		.sort()
		.join('|');
}

const TRANSITIONS: Record<SessionState, SessionState[]> = {
	NEW: ['PHOTO_READY'],
	PHOTO_READY: ['SEGMENTING', 'REVIEW', 'PHOTO_READY'],
	SEGMENTING: ['REVIEW', 'PHOTO_READY'],
	REVIEW: ['SOLVING', 'SOLUTION_READY', 'PHOTO_READY', 'SEGMENTING'],
	SOLVING: ['SOLUTION_READY', 'REVIEW'],
	SOLUTION_READY: ['GUIDING', 'SOLVING', 'REVIEW', 'SOLUTION_READY'],
	GUIDING: ['SOLVING', 'SOLUTION_READY', 'COMPLETED', 'REVIEW'],
	COMPLETED: ['GUIDING'],
	ERROR_RECOVERABLE: []
};

/**
 * Checks shape and invariants of a document a client wants to store. Returns an
 * error message or null. Undo/redo may move to any earlier state, so callers
 * pass `allowAnyTransition` for those writes.
 */
export function validateDoc(
	prev: WorkspaceDoc,
	next: WorkspaceDoc,
	opts: { allowAnyTransition?: boolean } = {}
): string | null {
	if (!next || next.v !== 1) return 'Unknown document version';
	if (next.mode !== prev.mode) return 'Session mode cannot change';
	if (!Array.isArray(next.pieces) || !Array.isArray(next.placements) || !next.history) return 'Malformed document';
	if (next.state === 'ERROR_RECOVERABLE') return 'Clients cannot store an error state';
	if (prev.state !== next.state && !opts.allowAnyTransition) {
		const ok = prev.state === 'ERROR_RECOVERABLE' || TRANSITIONS[prev.state]?.includes(next.state);
		if (!ok) return `Cannot go from ${prev.state} to ${next.state}`;
	}
	const ids = new Set<string>();
	for (const p of next.pieces) {
		if (ids.has(p.id)) return 'Duplicate piece id';
		ids.add(p.id);
		if (!next.masks[p.maskKey]) return `Piece ${p.label} has no mask`;
	}
	// piece ids are stable: a piece may be removed but never disappear
	for (const p of prev.pieces) if (!ids.has(p.id)) return 'Pieces cannot be deleted, only removed';
	const accepted = activePieces(next);
	const needsPhoto: SessionState[] = ['REVIEW', 'SOLVING', 'SOLUTION_READY', 'GUIDING', 'COMPLETED'];
	if (needsPhoto.includes(next.state) && (!next.photo || !next.segment)) return 'A segmented photo is required first';
	const needsSolution: SessionState[] = ['SOLUTION_READY', 'GUIDING', 'COMPLETED'];
	if (needsSolution.includes(next.state)) {
		const act = activeCandidate(next);
		if (!act || !next.grid) return 'A solution is required first';
		if (act.solution.rows * act.solution.cols !== accepted.length) return 'Solution does not match the pieces';
		const used = new Set(act.candidate.placements.map((p) => p.pieceId));
		if (used.size !== accepted.length || accepted.some((p) => !used.has(p.id))) return 'Solution does not cover every piece';
	}
	if (next.state === 'COMPLETED') {
		const placed = new Set(next.placements.map((p) => p.pieceId));
		if (accepted.some((p) => !placed.has(p.id))) return 'Not every piece has been placed';
	}
	for (const c of next.constraints) {
		if (!ids.has(c.pieceA) || !ids.has(c.pieceB)) return 'Constraint refers to an unknown piece';
	}
	return null;
}
