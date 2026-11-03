<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import {
		ArrowRight,
		BoxSelect,
		Check,
		CircleAlert,
		Crosshair,
		Eraser,
		MousePointer2,
		RefreshCcw,
		RotateCcw,
		ScanLine,
		Sparkles,
		SquareDashedMousePointer,
		TriangleAlert,
		Undo2
	} from '@lucide/svelte';
	import type { PromptObject } from '@meta-sam/parser';
	import AppBar from '$lib/components/AppBar.svelte';
	import PhotoStage, { type StagePointer } from '$lib/components/PhotoStage.svelte';
	import PieceOverlay, { type OverlayItem } from '$lib/components/PieceOverlay.svelte';
	import PieceThumb from '$lib/components/PieceThumb.svelte';
	import { ApiError, api } from '$lib/client/api';
	import { gridOptions } from '$lib/client/puzzle';
	import { outlineFor, pointInPolygon, quickOutline } from '$lib/client/render';
	import { sampleUrl } from '$lib/client/sample';
	import { maskIssues, newPieceRecords, refine, segmentLive, segmentReplay, toRecord } from '$lib/client/segment';
	import { toast } from '$lib/client/toasts.svelte';
	import { pieceLabel, Workspace } from '$lib/client/workspace.svelte';
	import { maskFromRecord } from '$lib/sam/masks';
	import { maskIoU, decodeRLE } from '$lib/vision/mask';
	import type { Pt, SideType } from '$lib/vision/types';
	import type { PieceRecord } from '$lib/shared/doc';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const ws = $derived(Workspace.get(data.id));
	const doc = $derived(ws.doc);

	type Tool = 'select' | 'point' | 'box' | 'remove' | 'corners';
	let tool = $state<Tool>('select');
	let selectedId = $state<string | null>(null);
	let stageScale = $state(1);
	let stage = $state<PhotoStage>();

	// segmentation progress
	let segStage = $state<'idle' | 'finding' | 'preparing'>('idle');
	let segError = $state<ApiError | null>(null);
	let liveMasks = $state<{ id: string; outline: Pt[]; centroid: Pt }[]>([]);
	let abort = $state<AbortController | null>(null);

	// refinement / drawing
	let pendingAt = $state<Pt | null>(null);
	let boxStart = $state<Pt | null>(null);
	let boxEnd = $state<Pt | null>(null);
	let remaskPoints = $state<Pt[]>([]);
	let remaskOf = $state<string | null>(null);

	// corner editing
	let draftCorners = $state<Pt[] | null>(null);
	let dragHandle = $state<number | null>(null);

	// grid
	let rows = $state(0);
	let cols = $state(0);

	const pieces = $derived(ws.pieces);
	const selected = $derived(pieces.find((p) => p.id === selectedId) ?? null);
	const selectedGeom = $derived(selected ? ws.geom(selected) : undefined);
	const issues = $derived(doc && pieces.length ? maskIssues(doc, pieces) : new Map());
	const geomIssues = (p: PieceRecord) => [...(ws.geom(p)?.issues ?? []), ...(ws.geomError(p) ? ['We could not trace this outline'] : [])];
	const needsReview = (p: PieceRecord) => (issues.get(p.id)?.length ?? 0) > 0 || geomIssues(p).length > 0;
	const reviewCount = $derived(pieces.filter(needsReview).length);
	const grid = $derived(gridOptions(pieces.map((p) => ws.geom(p))));
	const removed = $derived(doc?.pieces.filter((p) => p.status === 'removed') ?? []);
	const gridOk = $derived(rows > 0 && cols > 0 && rows * cols === pieces.length);
	const busy = $derived(segStage !== 'idle' || pendingAt !== null);

	// seed the grid from the saved choice or the recommendation
	$effect(() => {
		if (rows || !doc) return;
		if (doc.grid) {
			rows = doc.grid.rows;
			cols = doc.grid.cols;
		} else if (grid.recommended) {
			rows = grid.recommended.rows;
			cols = grid.recommended.cols;
		}
	});

	// start scanning once the photo is in place
	let started = false;
	$effect(() => {
		if (!doc || started) return;
		if ((doc.state === 'PHOTO_READY' || doc.state === 'SEGMENTING') && !doc.segment) {
			started = true;
			void scan(false);
		}
	});

	onDestroy(() => abort?.abort());

	async function scan(live: boolean) {
		if (!doc?.photo) return;
		segError = null;
		segStage = 'finding';
		liveMasks = [];
		abort = new AbortController();
		const prompt = 'jigsaw puzzle piece';
		try {
			if (doc.state === 'PHOTO_READY') await ws.commit('Start scan', (d) => (d.state = 'SEGMENTING'), { undoable: false });
			const onMasks = (records: readonly Parameters<typeof maskFromRecord>[0][]) => {
				// progressive outlines as each mask arrives
				const seen = new Set(liveMasks.map((m) => m.id));
				for (const r of records) {
					if (seen.has(r.objectId)) continue;
					liveMasks.push({ id: r.objectId, ...quickOutline(maskFromRecord(r)) });
				}
			};
			let mediaId = doc.photo.mediaId;
			let outcome;
			const sample = doc.photo.source === 'sample';
			if (sample && !live) {
				outcome = await segmentReplay(sampleUrl('sam-stream.txt'), prompt, onMasks);
			} else {
				if (sample && doc.photo.url.startsWith('/sample/')) {
					// "Run with Meta API": upload the sample photo as this session's own media
					const blob = await (await fetch(doc.photo.url)).blob();
					const media = await api.uploadMedia(ws.id, blob);
					mediaId = media.mediaId;
					await ws.commit('Use sample photo', (d) => (d.photo = { ...d.photo!, mediaId, url: media.url }), { undoable: false });
				}
				outcome = await segmentLive(ws.id, mediaId, prompt, onMasks, abort.signal);
			}
			segStage = 'preparing';
			const { records, masks } = newPieceRecords(outcome.pieces, 1, 'segment');
			await ws.commit(
				'Scan pieces',
				(d) => {
					for (const p of d.pieces) p.status = 'removed';
					d.pieces.push(...records);
					Object.assign(d.masks, masks);
					d.segment = outcome.record;
					d.state = 'REVIEW';
					d.solutions = [];
					d.active = undefined;
					d.placements = [];
				},
				{ undoable: !!doc.segment }
			);
			await ws.ensurePhoto();
			await ws.refreshGeometry();
			if (!records.length) segError = new ApiError('NO_MASKS', 'We couldn’t see the pieces clearly.', 0);
		} catch (err) {
			if ((err as Error).name === 'AbortError') return;
			segError = err instanceof ApiError ? err : new ApiError('INTERNAL', 'The scan failed. Your photo is saved.', 0, true);
			if (doc.state === 'SEGMENTING' && !doc.segment) await ws.commit('Scan failed', (d) => (d.state = 'PHOTO_READY'), { undoable: false });
		} finally {
			segStage = 'idle';
			liveMasks = [];
			abort = null;
		}
	}

	function overlayItems(): OverlayItem[] {
		if (!doc) return [];
		const items: OverlayItem[] = [];
		for (const p of pieces) {
			const g = ws.geom(p);
			const o = g ? { outline: g.outline, centroid: g.centroid } : outlineFor(p.maskKey, doc.masks[p.maskKey]);
			let tone: OverlayItem['tone'] = needsReview(p) ? 'review' : 'default';
			if (selectedId) tone = p.id === selectedId ? 'selected' : needsReview(p) ? 'review' : 'dim';
			items.push({ id: p.id, label: p.label, outline: o.outline, centroid: o.centroid, tone });
		}
		return items;
	}

	function hit(x: number, y: number): PieceRecord | undefined {
		if (!doc) return;
		return pieces.find((p) => {
			const g = ws.geom(p);
			const o = g?.outline ?? outlineFor(p.maskKey, doc.masks[p.maskKey]).outline;
			return pointInPolygon({ x, y }, o);
		});
	}

	function setTool(t: Tool) {
		tool = t;
		boxStart = boxEnd = null;
		remaskOf = null;
		remaskPoints = [];
		if (t === 'corners' && selected && selectedGeom) draftCorners = selectedGeom.corners.map((c) => ({ ...c }));
		else draftCorners = null;
	}

	function select(p: PieceRecord | undefined) {
		selectedId = p?.id ?? null;
		if (tool === 'corners') draftCorners = p && ws.geom(p) ? ws.geom(p)!.corners.map((c) => ({ ...c })) : null;
	}

	function onPointer(e: StagePointer) {
		if (!doc || busy) return;
		const pt = { x: e.x, y: e.y };
		if (tool === 'corners' && draftCorners) {
			const r = 18 / stageScale;
			if (e.kind === 'down') {
				const k = draftCorners.findIndex((c) => Math.hypot(c.x - pt.x, c.y - pt.y) < r);
				dragHandle = k >= 0 ? k : null;
			} else if (e.kind === 'move' && dragHandle !== null) {
				draftCorners[dragHandle] = pt;
			} else if (e.kind === 'up') {
				dragHandle = null;
			} else if (e.kind === 'tap' && dragHandle === null) {
				const p = hit(pt.x, pt.y);
				if (p && p.id !== selectedId) select(p);
			}
			return;
		}
		if (tool === 'box') {
			if (e.kind === 'down') {
				boxStart = pt;
				boxEnd = pt;
			} else if (e.kind === 'move' && boxStart) boxEnd = pt;
			else if (e.kind === 'up' && boxStart && boxEnd) {
				const b = normBox(boxStart, boxEnd);
				boxStart = boxEnd = null;
				if (b.right - b.left > 12 && b.bottom - b.top > 12) void addPiece({ box: b }, { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
			}
			return;
		}
		if (e.kind !== 'tap') return;
		if (remaskOf) {
			remaskPoints = [...remaskPoints, pt];
			return;
		}
		if (tool === 'point') {
			const existing = hit(pt.x, pt.y);
			if (existing) {
				toast(`That spot is already outlined as ${pieceLabel(existing.label)}.`, 'info');
				select(existing);
				return;
			}
			void addPiece({ points: [{ x: Math.round(pt.x), y: Math.round(pt.y) }] }, pt);
			return;
		}
		const p = hit(pt.x, pt.y);
		if (tool === 'remove' && p) {
			removePiece(p);
			return;
		}
		select(p);
	}

	function normBox(a: Pt, b: Pt) {
		return {
			left: Math.floor(Math.min(a.x, b.x)),
			top: Math.floor(Math.min(a.y, b.y)),
			right: Math.ceil(Math.max(a.x, b.x)),
			bottom: Math.ceil(Math.max(a.y, b.y))
		};
	}

	async function addPiece(prompt: PromptObject['prompts'][number], at: Pt) {
		if (!doc?.photo || doc.photo.url.startsWith('/sample/')) {
			toast('Adding pieces calls the live scanner. Choose “Run with Meta API” first to use your own scan of the sample.', 'info');
			return;
		}
		pendingAt = at;
		try {
			const out = await refine(ws.id, doc.photo.mediaId, [{ id: 1, prompts: [prompt] }]);
			const m = out[0];
			if (!m) {
				toast('The scanner did not find a piece there. Try a box around the whole piece.', 'warning');
				return;
			}
			const dup = pieces.find((p) => maskIoU(decodeRLE(doc.masks[p.maskKey].rle, doc.masks[p.maskKey]), m.mask) > 0.5);
			if (dup) {
				toast(`That piece is already outlined as ${pieceLabel(dup.label)}.`, 'info');
				select(dup);
				return;
			}
			const next = Math.max(0, ...doc.pieces.filter((p) => p.status !== 'removed').map((p) => p.label)) + 1;
			const { records, masks } = newPieceRecords([m], next, 'refine');
			await ws.commit(`Add ${pieceLabel(next)}`, (d) => {
				d.pieces.push(...records);
				Object.assign(d.masks, masks);
			});
			selectedId = records[0].id;
			toast(`Added ${pieceLabel(next)}.`, 'success');
		} catch (err) {
			toast((err as ApiError).message ?? 'Could not add that piece.', 'error');
		} finally {
			pendingAt = null;
		}
	}

	async function remask() {
		if (!doc?.photo || !selected || !remaskPoints.length) return;
		const m = doc.masks[selected.maskKey];
		const padX = Math.round(m.width * 0.12);
		const padY = Math.round(m.height * 0.12);
		const W = doc.photo.width;
		const H = doc.photo.height;
		const box = {
			left: Math.max(0, m.left - padX),
			top: Math.max(0, m.top - padY),
			right: Math.min(W, m.left + m.width + padX),
			bottom: Math.min(H, m.top + m.height + padY)
		};
		const target = selected;
		pendingAt = remaskPoints[0];
		try {
			const out = await refine(ws.id, doc.photo.mediaId, [
				{ id: 1, prompts: [{ box, points: remaskPoints.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) }] }
			]);
			if (!out[0]) {
				toast('The scanner returned no mask. Your original mask is unchanged.', 'warning');
				return;
			}
			const version = target.version + 1;
			const key = `${target.id}@${version}`;
			await ws.commit(`Edit mask of ${pieceLabel(target.label)}`, (d) => {
				d.masks[key] = toRecord(out[0].mask);
				const p = d.pieces.find((x) => x.id === target.id)!;
				p.maskKey = key;
				p.version = version;
				p.corners = undefined;
				p.status = 'accepted';
			});
			toast(`Updated the mask of ${pieceLabel(target.label)}.`, 'success');
		} catch (err) {
			toast((err as ApiError).message ?? 'Could not update the mask.', 'error');
		} finally {
			pendingAt = null;
			remaskOf = null;
			remaskPoints = [];
		}
	}

	function removePiece(p: PieceRecord) {
		void ws.commit(`Remove ${pieceLabel(p.label)}`, (d) => {
			d.pieces.find((x) => x.id === p.id)!.status = 'removed';
		});
		if (selectedId === p.id) selectedId = null;
		toast(`Removed ${pieceLabel(p.label)}.`, 'info', { label: 'Undo', run: () => ws.undo() });
	}

	function restorePiece(p: PieceRecord) {
		void ws.commit(`Restore ${pieceLabel(p.label)}`, (d) => {
			d.pieces.find((x) => x.id === p.id)!.status = 'accepted';
		});
	}

	function saveCorners() {
		if (!selected || !draftCorners) return;
		const target = selected;
		const corners = draftCorners.map((c) => ({ x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10 })) as PieceRecord['corners'];
		void ws.commit(`Edit corners of ${pieceLabel(target.label)}`, (d) => {
			d.pieces.find((x) => x.id === target.id)!.corners = corners;
		});
		setTool('select');
		toast(`Saved corners for ${pieceLabel(target.label)}.`, 'success');
	}

	function autoCorners() {
		if (!selected) return;
		const target = selected;
		void ws.commit(`Reset corners of ${pieceLabel(target.label)}`, (d) => {
			d.pieces.find((x) => x.id === target.id)!.corners = undefined;
		});
		setTool('select');
	}

	function setSideType(side: number, t: SideType | 'auto') {
		if (!selected) return;
		const target = selected;
		void ws.commit(`Change a side of ${pieceLabel(target.label)}`, (d) => {
			const p = d.pieces.find((x) => x.id === target.id)!;
			const next = { ...(p.sideTypes ?? {}) };
			if (t === 'auto') delete next[side];
			else next[side] = t;
			p.sideTypes = Object.keys(next).length ? next : undefined;
		});
	}

	function resetChanges() {
		void ws.commit('Reset changes', (d) => {
			for (const p of d.pieces) {
				if (p.origin === 'segment') p.status = 'accepted';
				else p.status = 'removed';
				p.corners = undefined;
				p.sideTypes = undefined;
			}
		});
		selectedId = null;
		toast('Restored the original scan. Undo brings your edits back.', 'info', { label: 'Undo', run: () => ws.undo() });
	}

	async function findMatches() {
		if (!gridOk) return;
		await ws.commit(`Grid ${rows}×${cols}`, (d) => {
			d.grid = { rows, cols };
			if (d.state === 'REVIEW' || d.state === 'SOLUTION_READY' || d.state === 'GUIDING') d.state = 'SOLVING';
		});
		await goto(`/p/${ws.id}/solve`);
	}

	function onKey(e: KeyboardEvent) {
		if ((e.target as HTMLElement).closest('input, select, textarea')) return;
		if (e.key === 'Escape') {
			if (remaskOf) remaskOf = null;
			else if (tool !== 'select') setTool('select');
			else selectedId = null;
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
			removePiece(selected);
		} else if (e.key === 'Enter' && gridOk && !busy && tool === 'select' && !(e.target as HTMLElement).closest('button')) {
			void findMatches();
		}
	}

	const tools: { id: Tool; label: string; icon: typeof MousePointer2; hint: string }[] = [
		{ id: 'select', label: 'Select', icon: MousePointer2, hint: 'Tap a piece to inspect it' },
		{ id: 'point', label: 'Add by click', icon: Crosshair, hint: 'Tap the middle of a missing piece' },
		{ id: 'box', label: 'Add by box', icon: SquareDashedMousePointer, hint: 'Drag a box around a missing piece' },
		{ id: 'remove', label: 'Remove', icon: Eraser, hint: 'Tap a wrong outline to remove it' },
		{ id: 'corners', label: 'Edit corners', icon: BoxSelect, hint: 'Drag the four base corners of the selected piece' }
	];
	const sideLabels: Record<SideType, string> = { flat: 'Flat', tab: 'Tab', socket: 'Socket', unknown: 'Unclear' };
	const sideColor: Record<SideType, string> = { flat: '#6A7770', tab: '#167A6B', socket: '#B97720', unknown: '#B74444' };
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><title>Review pieces · PuzzleAR</title></svelte:head>

<AppBar {ws} step={2} />

{#if doc}
	<main id="main" class="mx-auto grid max-w-[1440px] gap-5 px-4 pt-4 pb-32 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-6 lg:pb-8">
		<section class="flex min-w-0 flex-col gap-3">
			<!-- tool bar -->
			<div class="card flex flex-wrap items-center gap-1 p-1.5" role="toolbar" aria-label="Review tools">
				{#each tools as t (t.id)}
					<button
						class="btn btn-sm gap-1.5 {tool === t.id ? 'bg-ink text-white hover:bg-ink' : 'btn-ghost'}"
						aria-pressed={tool === t.id}
						title={t.hint}
						disabled={busy || (t.id === 'corners' && !selected)}
						onclick={() => setTool(t.id)}
					>
						<t.icon class="size-4" aria-hidden="true" /><span class="max-sm:sr-only">{t.label}</span>
					</button>
				{/each}
				<span class="bg-line mx-1 h-6 w-px max-sm:hidden"></span>
				<button class="btn btn-sm btn-quiet gap-1.5" onclick={resetChanges} disabled={busy}><RotateCcw class="size-4" /><span class="max-md:sr-only">Reset changes</span></button>
				<p class="text-muted ml-auto pr-2 text-[0.8125rem] max-lg:hidden">{tools.find((t) => t.id === tool)?.hint}</p>
			</div>

			<div class="relative">
				<PhotoStage
					bind:this={stage}
					bind:scale={stageScale}
					src={doc.photo?.url}
					width={doc.photo?.width ?? 1600}
					height={doc.photo?.height ?? 1200}
					class="lg:h-[calc(100vh-11.5rem)]"
					onpointer={onPointer}
					pan={tool === 'select' || tool === 'remove' || tool === 'point'}
					cursor={tool === 'point' || remaskOf ? 'crosshair' : tool === 'box' ? 'crosshair' : tool === 'remove' ? 'not-allowed' : 'pointer'}
					dim={segStage !== 'idle'}
				>
					{#if segStage !== 'idle'}
						<PieceOverlay items={liveMasks.map((m, i) => ({ id: m.id, label: i + 1, outline: m.outline, centroid: m.centroid, tone: 'new' }))} />
					{:else}
						<PieceOverlay items={overlayItems()} />
					{/if}
					{#if boxStart && boxEnd}
						{@const b = normBox(boxStart, boxEnd)}
						<rect x={b.left} y={b.top} width={b.right - b.left} height={b.bottom - b.top} fill="#2fb39f" fill-opacity="0.15" stroke="#fff" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" />
					{/if}
					{#each remaskPoints as p, i (i)}
						<circle cx={p.x} cy={p.y} r={7 / stageScale} fill="#167A6B" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke" />
					{/each}
					{#if pendingAt}
						<circle cx={pendingAt.x} cy={pendingAt.y} r={22 / stageScale} fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="8 6" vector-effect="non-scaling-stroke" style="animation: breathe 1s ease-in-out infinite" />
					{/if}
					{#if tool === 'corners' && draftCorners}
						<path d={draftCorners.map((c, i) => `${i ? 'L' : 'M'}${c.x} ${c.y}`).join('') + 'Z'} fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" />
						{#each draftCorners as c, i (i)}
							<g style="transform: translate({c.x}px, {c.y}px) scale(calc(1 / var(--z)))">
								<circle r="13" fill="#167A6B" fill-opacity="0.25" stroke="#fff" stroke-width="2" />
								<circle r="4" fill="#fff" />
								<text y="-18" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" style="paint-order: stroke" stroke="#24312d" stroke-width="3">{i + 1}</text>
							</g>
						{/each}
					{/if}
				</PhotoStage>

				{#if segStage !== 'idle'}
					<div class="pointer-events-none absolute inset-x-3 top-3 flex justify-center" role="status" aria-live="polite">
						<div class="pointer-events-auto flex items-center gap-3 rounded-full bg-[#1f2a25]/90 py-2 pr-2 pl-4 text-[0.875rem] text-white shadow-lg backdrop-blur">
							<ol class="flex items-center gap-2 whitespace-nowrap">
								<li class="text-white/55 max-sm:hidden">Uploading photo</li>
								<li aria-hidden="true" class="text-white/35 max-sm:hidden">→</li>
								<li class={segStage === 'finding' ? 'font-semibold' : 'text-white/55 max-sm:hidden'}>
									<span class="max-sm:hidden">Finding your puzzle pieces</span><span class="sm:hidden">Finding pieces</span>{segStage === 'finding' ? '…' : ''}
									{#if liveMasks.length}<span class="tabular text-white/70"> · {liveMasks.length}<span class="max-sm:hidden"> so far</span></span>{/if}
								</li>
								<li aria-hidden="true" class="text-white/35 max-sm:hidden">→</li>
								<li class={segStage === 'preparing' ? 'font-semibold' : 'text-white/55 max-sm:hidden'}>Preparing edges</li>
							</ol>
							{#if segStage === 'finding' && abort}
								<button class="rounded-full bg-white/12 px-3 py-1 font-medium hover:bg-white/20" onclick={() => abort?.abort()}>Cancel</button>
							{/if}
						</div>
					</div>
				{/if}
				{#if remaskOf}
					<div class="absolute inset-x-3 top-3 flex justify-center">
						<div class="flex items-center gap-2 rounded-full bg-[#1f2a25]/90 py-1.5 pr-1.5 pl-4 text-[0.875rem] text-white shadow-lg backdrop-blur">
							<span>Tap the parts of {pieceLabel(selected?.label ?? 0)} the outline missed</span>
							<button class="rounded-full bg-white/15 px-3 py-1 font-medium hover:bg-white/25" onclick={() => ((remaskOf = null), (remaskPoints = []))}>Cancel</button>
							<button class="bg-teal hover:bg-teal-hover rounded-full px-3 py-1 font-semibold disabled:opacity-50" disabled={!remaskPoints.length} onclick={remask}>Re-scan piece</button>
						</div>
					</div>
				{/if}
			</div>
		</section>

		<aside class="flex flex-col gap-4 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto lg:pb-2" aria-label="Piece inspector">
			{#if segError}
				<div class="card border-error/30 p-5" role="alert">
					<div class="flex items-start gap-3">
						<CircleAlert class="text-error mt-0.5 size-5 shrink-0" />
						<div>
							<p class="font-semibold">{segError.message}</p>
							{#if segError.code === 'NO_MASKS'}
								<p class="text-muted mt-1 text-[0.875rem]">Try a plainer background, more light, or more space between pieces. You can also tap pieces to add them one by one.</p>
							{/if}
						</div>
					</div>
					<div class="mt-4 flex flex-wrap gap-2">
						{#if segError.retryable || segError.code === 'NO_MASKS'}
							<button class="btn btn-primary btn-sm" onclick={() => scan(doc.photo?.source !== 'sample' || !doc.photo.url.startsWith('/sample/'))}><RefreshCcw class="size-4" /> Try again</button>
						{/if}
						{#if segError.code === 'NO_MASKS'}
							<button class="btn btn-secondary btn-sm" onclick={() => setTool('point')}><Crosshair class="size-4" /> Add by tap</button>
						{/if}
						<a class="btn btn-secondary btn-sm" href="/new">Retake photo</a>
					</div>
				</div>
			{/if}

			<div class="card p-5">
				{#if !doc.segment}
					<div class="bg-line h-7 w-44 rounded" style="animation: breathe 1.4s ease-in-out infinite"></div>
					<div class="bg-line mt-3 h-4 w-60 rounded" style="animation: breathe 1.4s ease-in-out infinite"></div>
				{:else}
					<h1 class="text-h2 font-semibold tracking-[-0.02em]">
						Found <span class="tabular">{pieces.length}</span> {pieces.length === 1 ? 'piece' : 'pieces'}
					</h1>
					<p class="text-muted mt-1 text-[0.875rem]">
						{#if reviewCount}
							<span class="text-amber-ink font-medium">{reviewCount} to look at</span> · amber dashed outlines.
						{:else if pieces.length}
							Every outline looks clean. Tap any piece to inspect it.
						{/if}
					</p>
					{#if doc.segment.preprocessed}
						<div class="bg-ground-deep mt-4 rounded-[12px] p-3.5 text-[0.8125rem] leading-5">
							<p><span class="font-semibold">Preprocessed example.</span> These outlines replay a real Meta SAM 3.1 response stored for this sample photo.</p>
							<button class="btn btn-secondary btn-sm mt-3 w-full" onclick={() => scan(true)} disabled={busy || !ws.scannerAvailable}>
								<Sparkles class="size-4" /> Run with Meta API
							</button>
							{#if !ws.scannerAvailable}<p class="text-muted mt-2">The live scanner is unavailable on this server.</p>{/if}
						</div>
					{:else if doc.segment.providerRequestId}
						<p class="text-muted mt-3 text-[0.75rem]">Live Meta SAM 3.1 scan · request {doc.segment.providerRequestId.slice(0, 8)}</p>
					{/if}
					{#if doc.photo?.warnings.length}
						<ul class="mt-3 grid gap-1.5">
							{#each doc.photo.warnings as w (w)}
								<li class="text-amber-ink flex gap-2 text-[0.8125rem] leading-5"><TriangleAlert class="mt-0.5 size-3.5 shrink-0" />{w}</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>

			{#if selected}
				{@const sIssues = [...(issues.get(selected.id) ?? []), ...geomIssues(selected).map((m) => ({ message: m, action: m.includes('Corners') ? 'Use Edit corners to drag them into place' : m.includes('side') ? 'Set the side types below' : 'Edit the mask or remove it' }))]}
				<div class="card p-5" style="animation: rise 200ms var(--ease-out-expo) both">
					<div class="flex items-start gap-4">
						<div class="bg-ground-deep grid size-[140px] shrink-0 place-items-center rounded-[12px]">
							<PieceThumb cutout={ws.cutout(selected)} mask={doc.masks[selected.maskKey]} geom={selectedGeom} showSides sideTypes={selected.sideTypes} size={132} />
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="piece-tag">{pieceLabel(selected.label)}</span>
								{#if selected.origin === 'refine'}<span class="chip bg-ground-deep text-muted">Added by you</span>{/if}
							</div>
							{#if selected.confidence !== undefined}
								<p class="text-muted tabular mt-2 text-[0.8125rem]">Scanner confidence {selected.confidence.toFixed(2)}</p>
							{/if}
							{#if sIssues.length}
								<p class="text-amber-ink mt-1 text-[0.875rem] font-medium">Needs a look</p>
							{:else}
								<p class="text-verified mt-1 flex items-center gap-1 text-[0.875rem] font-medium"><Check class="size-4" /> Mask looks good</p>
							{/if}
						</div>
					</div>
					{#if sIssues.length}
						<ul class="mt-4 grid gap-2">
							{#each sIssues as is, k (k)}
								<li class="bg-amber-soft rounded-[10px] px-3 py-2 text-[0.8125rem] leading-5">
									<p class="text-amber-ink font-medium">{is.message}</p>
									<p class="text-muted">{is.action}</p>
								</li>
							{/each}
						</ul>
					{/if}
					{#if selectedGeom}
						<fieldset class="mt-4">
							<legend class="label">Side shapes <span class="font-normal">· numbered on the picture</span></legend>
							<ul class="mt-2 grid gap-1.5">
								{#each selectedGeom.sides as s, k (k)}
									{@const chosen = selected.sideTypes?.[k]}
									<li class="flex items-center gap-2">
										<span class="tabular grid size-7 shrink-0 place-items-center rounded-full text-[0.75rem] font-bold text-white" style="background:{sideColor[chosen ?? s.type]}">{k + 1}</span>
										<div class="border-line bg-ground-deep/60 grid flex-1 grid-cols-3 gap-0.5 rounded-[10px] border p-0.5" role="radiogroup" aria-label="Side {k + 1} shape">
											{#each ['flat', 'tab', 'socket'] as const as opt (opt)}
												{@const on = (chosen ?? s.type) === opt}
												<button
													role="radio"
													aria-checked={on}
													class="h-9 rounded-[8px] text-[0.8125rem] font-medium whitespace-nowrap transition-colors {on ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(36_49_45/0.15)]' : 'text-muted hover:text-ink'}"
													onclick={() => setSideType(k, chosen === opt || (!chosen && s.type === opt) ? 'auto' : opt)}
												>
													{sideLabels[opt]}{#if on && !chosen}<span class="text-muted ml-1 text-[0.6875rem] font-normal">auto</span>{/if}
												</button>
											{/each}
										</div>
									</li>
								{/each}
							</ul>
							{#if selectedGeom.sides.some((x, k) => x.type === 'unknown' && !selected.sideTypes?.[k])}
								<p class="text-amber-ink mt-2 text-[0.8125rem] leading-5">Unclear sides have nothing selected yet. Pick the shape you see on the piece.</p>
							{/if}
						</fieldset>
					{/if}
					<div class="mt-4 flex flex-wrap gap-2">
						{#if tool === 'corners'}
							<button class="btn btn-primary btn-sm" onclick={saveCorners}><Check class="size-4" /> Save corners</button>
							<button class="btn btn-secondary btn-sm" onclick={autoCorners}>Use automatic</button>
							<button class="btn btn-quiet btn-sm" onclick={() => setTool('select')}>Cancel</button>
						{:else}
							<button class="btn btn-secondary btn-sm" onclick={() => ((remaskOf = selected!.id), (remaskPoints = []), (tool = 'select'))} disabled={busy || doc.photo?.url.startsWith('/sample/')} title={doc.photo?.url.startsWith('/sample/') ? 'Run with Meta API first' : ''}><ScanLine class="size-4" /> Edit mask</button>
							<button class="btn btn-secondary btn-sm" onclick={() => setTool('corners')} disabled={!selectedGeom}><BoxSelect class="size-4" /> Edit corners</button>
							<button class="btn btn-danger btn-sm" onclick={() => removePiece(selected!)}><Eraser class="size-4" /> Remove</button>
						{/if}
					</div>
				</div>
			{:else if pieces.length}
				<div class="card p-5">
					<h2 class="label">All pieces</h2>
					<ul class="mt-3 grid grid-cols-6 gap-1.5 sm:grid-cols-8 lg:grid-cols-6" aria-label="Pieces">
						{#each [...pieces].sort((a, b) => a.label - b.label) as p (p.id)}
							<li>
								<button
									class="tabular h-9 w-full rounded-[8px] text-[0.8125rem] font-semibold transition-colors {needsReview(p) ? 'bg-amber-soft text-amber-ink outline-1 outline-dashed outline-amber/60' : 'bg-ground-deep hover:bg-line'}"
									onclick={() => select(p)}
									aria-label="Piece {pieceLabel(p.label)}{needsReview(p) ? ', needs a look' : ''}">{String(p.label).padStart(2, '0')}</button
								>
							</li>
						{/each}
					</ul>
					{#if removed.length}
						<details class="mt-4 text-[0.8125rem]">
							<summary class="text-muted hover:text-ink cursor-pointer">{removed.length} removed</summary>
							<ul class="mt-2 flex flex-wrap gap-1.5">
								{#each removed as p (p.id)}
									<li><button class="btn btn-secondary btn-sm" onclick={() => restorePiece(p)}><Undo2 class="size-3.5" /> {pieceLabel(p.label)}</button></li>
								{/each}
							</ul>
						</details>
					{/if}
				</div>
			{/if}

			{#if doc.segment && pieces.length}
				<div class="card p-5">
					<div class="flex items-baseline justify-between gap-3">
						<h2 class="font-semibold">Grid size</h2>
						{#if grid.recommended}
							<span class="text-muted text-[0.8125rem]">We suggest {grid.recommended.rows} × {grid.recommended.cols}</span>
						{/if}
					</div>
					<div class="mt-3 flex items-center gap-2">
						<label class="border-line-strong bg-surface flex items-center rounded-[10px] border">
							<span class="sr-only">Rows</span>
							<input type="number" min="1" max="8" bind:value={rows} class="tabular h-11 w-14 bg-transparent text-center font-semibold focus:outline-none" aria-label="Rows" />
						</label>
						<span class="text-muted">×</span>
						<label class="border-line-strong bg-surface flex items-center rounded-[10px] border">
							<span class="sr-only">Columns</span>
							<input type="number" min="1" max="8" bind:value={cols} class="tabular h-11 w-14 bg-transparent text-center font-semibold focus:outline-none" aria-label="Columns" />
						</label>
						<div class="ml-auto flex flex-wrap justify-end gap-1.5">
							{#each grid.options.slice(0, 3) as o (o.rows + 'x' + o.cols)}
								<button class="btn btn-sm {o.rows === rows && o.cols === cols ? 'bg-teal-soft text-teal' : 'btn-secondary'}" onclick={() => ((rows = o.rows), (cols = o.cols))} title={o.reason}>{o.rows}×{o.cols}</button>
							{/each}
						</div>
					</div>
					{#if rows && cols && !gridOk}
						<p class="bg-amber-soft text-amber-ink mt-3 rounded-[10px] px-3 py-2 text-[0.8125rem] leading-5" role="status">
							We found {pieces.length} pieces, but your grid needs {rows * cols}.
							{rows * cols > pieces.length ? 'Add the missing pieces, or change the grid.' : 'Remove extra outlines, or change the grid.'}
							If you only have part of the puzzle, find likely pairs instead.
						</p>
					{:else if !rows}
						<p class="text-muted mt-3 text-[0.8125rem]">The flat edges don't point to one clear size yet. Pick the grid your puzzle has.</p>
					{/if}
				</div>
			{/if}

			<div class="max-lg:bg-ground/95 max-lg:border-line max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:border-t max-lg:px-4 max-lg:pt-3 max-lg:pb-[calc(env(safe-area-inset-bottom)+12px)] max-lg:backdrop-blur-md lg:sticky lg:bottom-0 lg:bg-ground lg:pt-2 lg:pb-1">
				{#if gridOk || !doc.segment || pieces.length < 2}
					<button class="btn btn-primary h-12 w-full text-base" disabled={!gridOk || busy || ws.analyzing} onclick={findMatches}>
						Find Matches · <span class="tabular">{pieces.length}</span> pieces <ArrowRight class="size-[18px]" />
					</button>
					{#if doc.segment && pieces.length >= 2}
						<a href="/p/{ws.id}/pairs" class="btn btn-quiet btn-sm mt-1 w-full">Not every piece here? Find likely pairs</a>
					{/if}
				{:else}
					<a href="/p/{ws.id}/pairs" class="btn btn-primary h-12 w-full text-base {busy || ws.analyzing ? 'pointer-events-none opacity-45' : ''}">
						Find likely pairs · <span class="tabular">{pieces.length}</span> pieces <ArrowRight class="size-[18px]" />
					</a>
				{/if}
			</div>
		</aside>
	</main>
{/if}
