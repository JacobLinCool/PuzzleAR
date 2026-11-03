/**
 * Client-side session state. The server stores the document; this class keeps
 * a reactive copy, the decoded photo, cached piece geometry and the undo stack.
 */
import { SvelteMap } from 'svelte/reactivity';
import {
	HISTORY_LIMIT,
	activeCandidate,
	activePieces,
	restoreSnapshot,
	snapshotOf,
	type PieceRecord,
	type Snapshot,
	type WorkspaceDoc
} from '$lib/shared/doc';
import type { Linear } from '$lib/vision/rectify';
import type { PieceGeometry } from '$lib/vision/types';
import { ApiError, api } from './api';
import { loadPhoto, type LoadedPhoto } from './image';
import { makeCutout } from './render';
import { toast } from './toasts.svelte';
import * as vision from './vision.svelte';

export function geomKey(p: PieceRecord): string {
	return `${p.maskKey}|${JSON.stringify(p.corners ?? null)}|${JSON.stringify(p.sideTypes ?? null)}`;
}

const cache = new Map<string, Workspace>();

export class Workspace {
	id: string;
	doc = $state<WorkspaceDoc | null>(null);
	revision = $state(0);
	scannerAvailable = $state(true);
	expiresAt = $state(0);
	loadError = $state<ApiError | null>(null);
	photo = $state<LoadedPhoto | null>(null);
	photoError = $state<string | null>(null);
	saving = $state(false);
	analyzing = $state(false);
	geoms = new SvelteMap<string, PieceGeometry | { error: string }>();
	cutouts = new Map<string, HTMLCanvasElement>();
	private saveChain: Promise<unknown> = Promise.resolve();
	private photoPromise: Promise<LoadedPhoto | null> | null = null;
	private inflight = new Set<string>();
	/** Camera-tilt correction, estimated once from all pieces of the photo (null = top-down). */
	private rectify: Linear | null | undefined = undefined;

	static get(id: string): Workspace {
		let ws = cache.get(id);
		if (!ws) {
			ws = new Workspace(id);
			cache.set(id, ws);
		}
		return ws;
	}

	static forget(id: string) {
		cache.delete(id);
	}

	constructor(id: string) {
		this.id = id;
	}

	get pieces(): PieceRecord[] {
		return this.doc ? activePieces(this.doc) : [];
	}

	get canUndo() {
		return Boolean(this.doc?.history.undo.length);
	}
	get canRedo() {
		return Boolean(this.doc?.history.redo.length);
	}
	get candidate() {
		return this.doc ? activeCandidate(this.doc) : undefined;
	}

	pieceById(id: string) {
		return this.doc?.pieces.find((p) => p.id === id);
	}

	geom(p: PieceRecord): PieceGeometry | undefined {
		const g = this.geoms.get(geomKey(p));
		return g && !('error' in g) ? g : undefined;
	}

	geomError(p: PieceRecord): string | undefined {
		const g = this.geoms.get(geomKey(p));
		return g && 'error' in g ? g.error : undefined;
	}

	cutout(p: PieceRecord): HTMLCanvasElement | undefined {
		if (!this.photo || !this.doc) return undefined;
		let c = this.cutouts.get(p.maskKey);
		if (!c) {
			const m = this.doc.masks[p.maskKey];
			if (!m) return undefined;
			c = makeCutout(this.photo.bitmap, m);
			this.cutouts.set(p.maskKey, c);
		}
		return c;
	}

	async load(force = false) {
		if (this.doc && !force) {
			void this.ensurePhoto().then(() => this.refreshGeometry());
			return;
		}
		try {
			const s = await api.getSession(this.id);
			this.doc = s.doc;
			this.revision = s.revision;
			this.scannerAvailable = s.scannerAvailable;
			this.expiresAt = s.expiresAt;
			this.loadError = null;
		} catch (err) {
			this.loadError = err instanceof ApiError ? err : new ApiError('NETWORK', 'Could not load this puzzle.', 0, true);
			return;
		}
		await this.ensurePhoto();
		await this.refreshGeometry();
	}

	async ensurePhoto(): Promise<LoadedPhoto | null> {
		if (this.photo) return this.photo;
		if (!this.doc?.photo) return null;
		if (!this.photoPromise) {
			const url = this.doc.photo.url;
			this.photoPromise = loadPhoto(url)
				.then(async (p) => {
					await vision.loadImage(`photo:${this.doc!.photo!.mediaId}`, p.pixels);
					this.photo = p;
					this.photoError = null;
					return p;
				})
				.catch((err) => {
					this.photoError = String(err.message ?? err);
					this.photoPromise = null;
					return null;
				});
		}
		return this.photoPromise;
	}

	/** Recomputes geometry for pieces whose mask or manual overrides changed. */
	async refreshGeometry() {
		if (!this.doc || !this.photo) return;
		const todo = this.pieces.filter((p) => !this.geoms.has(geomKey(p)) && !this.inflight.has(geomKey(p)));
		if (!todo.length) {
			// another call is already computing these; wait for it
			while (this.inflight.size) await new Promise((r) => setTimeout(r, 30));
			return;
		}
		for (const p of todo) this.inflight.add(geomKey(p));
		this.analyzing = true;
		try {
			const items = todo.map((p) => ({
				key: geomKey(p),
				mask: this.doc!.masks[p.maskKey],
				opts: { corners: p.corners, sideTypes: p.sideTypes }
			}));
			let out;
			if (this.rectify === undefined && todo.length >= 4) {
				// first look at this photo: estimate the camera tilt from all pieces
				const all = await vision.analyzeAll(`photo:${this.doc.photo!.mediaId}`, items);
				this.rectify = all.rectify;
				out = all.results;
			} else {
				out = await vision.analyze(`photo:${this.doc.photo!.mediaId}`, items, this.rectify ?? null);
			}
			for (const r of out) this.geoms.set(r.key, r.geom ?? { error: r.error ?? 'BAD_CONTOUR' });
		} finally {
			for (const p of todo) this.inflight.delete(geomKey(p));
			this.analyzing = this.inflight.size > 0;
		}
	}

	/**
	 * Applies a user action: records an undo snapshot, mutates, then saves.
	 * `label` names the action in the undo toast.
	 */
	commit(label: string, mutate: (doc: WorkspaceDoc) => void, opts: { undoable?: boolean } = {}) {
		if (!this.doc) return Promise.resolve();
		const doc = this.doc;
		if (opts.undoable !== false) {
			doc.history.undo.push(snapshotOf($state.snapshot(doc) as WorkspaceDoc, label));
			if (doc.history.undo.length > HISTORY_LIMIT) doc.history.undo.shift();
			doc.history.redo = [];
		}
		mutate(doc);
		const p = this.save();
		void this.refreshGeometry();
		return p;
	}

	private save(history?: 'undo' | 'redo') {
		this.saveChain = this.saveChain.then(async () => {
			if (!this.doc) return;
			this.saving = true;
			try {
				const snapshot = $state.snapshot(this.doc) as WorkspaceDoc;
				const res = await api.saveDoc(this.id, this.revision, snapshot, history);
				this.revision = res.revision;
			} catch (err) {
				const e = err as ApiError;
				if (e.code === 'SESSION_CHANGED') {
					toast(e.message, 'warning');
					await this.load(true);
				} else if (e.code === 'INVALID_DOC') {
					toast(`That change could not be saved: ${e.message}`, 'error');
					await this.load(true);
				} else {
					toast(e.message ?? 'Could not save. We will retry with your next change.', 'error', {
						label: 'Retry',
						run: () => void this.save()
					});
				}
			} finally {
				this.saving = false;
			}
		});
		return this.saveChain;
	}

	undo() {
		const doc = this.doc;
		if (!doc || !doc.history.undo.length) return;
		const prev = $state.snapshot(doc.history.undo.pop()!) as Snapshot;
		doc.history.redo.push(snapshotOf($state.snapshot(doc) as WorkspaceDoc, prev.label));
		restoreSnapshot(doc, prev);
		toast(`Undid: ${prev.label}`, 'info', { label: 'Redo', run: () => this.redo() }, 3600);
		void this.save('undo');
		void this.refreshGeometry();
	}

	redo() {
		const doc = this.doc;
		if (!doc || !doc.history.redo.length) return;
		const next = $state.snapshot(doc.history.redo.pop()!) as Snapshot;
		doc.history.undo.push(snapshotOf($state.snapshot(doc) as WorkspaceDoc, next.label));
		restoreSnapshot(doc, next);
		toast(`Redid: ${next.label}`, 'info', undefined, 2400);
		void this.save('redo');
		void this.refreshGeometry();
	}

	/** Waits for queued saves to land (before navigating away, deleting...). */
	flush() {
		return this.saveChain;
	}
}

export function pieceLabel(n: number): string {
	return `#${String(n).padStart(2, '0')}`;
}
