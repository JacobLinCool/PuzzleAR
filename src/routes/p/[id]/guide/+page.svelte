<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import {
		ArrowRight,
		Camera,
		Check,
		CircleAlert,
		Hand,
		ImageUp,
		LayoutGrid,
		ScanLine,
		SkipForward,
		SquareDashed,
		TriangleAlert,
		Undo2,
		Video,
		X
	} from '@lucide/svelte';
	import AppBar from '$lib/components/AppBar.svelte';
	import BoardView from '$lib/components/BoardView.svelte';
	import CameraView from '$lib/components/CameraView.svelte';
	import ConfidenceChip from '$lib/components/ConfidenceChip.svelte';
	import PhotoStage, { type StagePointer } from '$lib/components/PhotoStage.svelte';
	import PieceOverlay, { type OverlayItem } from '$lib/components/PieceOverlay.svelte';
	import PieceThumb from '$lib/components/PieceThumb.svelte';
	import { bitmapToPixels, normalizePhoto } from '$lib/client/image';
	import { cellEdges, nextStep, SIDE_NAMES } from '$lib/client/puzzle';
	import { cutoutUrl, ghostMatrix, outlineInImage, svgPath, type BoardItem } from '$lib/client/render';
	import { sampleUrl } from '$lib/client/sample';
	import { simulatePhoto } from '$lib/client/simulate';
	import { toast } from '$lib/client/toasts.svelte';
	import * as vision from '$lib/client/vision.svelte';
	import { pieceLabel, Workspace } from '$lib/client/workspace.svelte';
	import { activeCandidate, type PlacementRecord } from '$lib/shared/doc';
	import { applyH, boardHomography } from '$lib/vision/homography';
	import type { Pt } from '$lib/vision/types';
	import type { VerifyResult } from '$lib/vision/verify';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const ws = $derived(Workspace.get(data.id));
	const doc = $derived(ws.doc);

	let view = $state<'photo' | 'camera'>('photo');
	let calibrating = $state(false);
	let taps = $state<Pt[]>([]);
	let checking = $state(false);
	let result = $state<(VerifyResult & { photoUrl?: string; simulated?: boolean }) | null>(null);
	let cam = $state<CameraView>();
	let camReady = $state(false);
	let fileInput = $state<HTMLInputElement>();
	let stage = $state<PhotoStage>();
	let checkSeq = 0;

	const act = $derived(doc ? activeCandidate(doc) : undefined);
	const cand = $derived(act?.candidate);
	const rows = $derived(act?.solution.rows ?? 0);
	const cols = $derived(act?.solution.cols ?? 0);
	const done = $derived(doc?.placements ?? []);
	const step = $derived(cand && doc ? nextStep(cand.placements, cand.edges, done, doc.skipped, rows, cols) : undefined);
	const piece = $derived(step ? ws.pieceById(step.pieceId) : undefined);
	const geom = $derived(piece ? ws.geom(piece) : undefined);
	const total = $derived(cand?.placements.length ?? 0);
	const isSample = $derived(doc?.photo?.source === 'sample');
	const calib = $derived(doc?.boardQuad && rows ? boardHomography(doc.boardQuad, rows, cols) : null);
	const H = $derived(calib?.valid ? calib.H : null);
	const placedIds = $derived(new Set(done.map((d) => d.pieceId)));
	const stepEdges = $derived(cand && step ? cellEdges(cand.placements, cand.edges, step).filter((e) => placedIds.has(e.neighbour.pieceId)) : []);

	// arrive in GUIDING; leave when finished
	$effect(() => {
		if (!doc) return;
		if (!cand) {
			void goto(`/p/${ws.id}/solve`, { replaceState: true });
			return;
		}
		if (doc.state === 'SOLUTION_READY') void ws.commit('Start assembling', (d) => ((d.state = 'GUIDING'), (d.guideStartedAt ??= Date.now())), { undoable: false });
	});

	$effect(() => {
		// a new step clears the last check result
		void step?.pieceId;
		result = null;
	});

	onDestroy(() => cam?.stop());

	const items = $derived.by((): BoardItem[] => {
		if (!cand || !doc || !ws.photo) return [];
		const out: BoardItem[] = [];
		for (const p of cand.placements) {
			const pc = ws.pieceById(p.pieceId);
			const g = pc && ws.geom(pc);
			const c = pc && ws.cutout(pc);
			if (pc && g && c) out.push({ placement: p, geom: g, mask: doc.masks[pc.maskKey], cutout: c });
		}
		return out;
	});
	const unplaced = $derived(new Set(cand?.placements.filter((p) => !placedIds.has(p.pieceId)).map((p) => p.pieceId) ?? []));

	function overlay(): OverlayItem[] {
		if (!doc) return [];
		return ws.pieces.map((p) => {
			const g = ws.geom(p);
			const tone: OverlayItem['tone'] = placedIds.has(p.id) ? 'placed' : p.id === piece?.id ? 'find' : 'dim';
			return { id: p.id, label: p.label, outline: g?.outline ?? [], centroid: g?.centroid ?? { x: 0, y: 0 }, tone };
		});
	}

	function startCalibration() {
		calibrating = true;
		taps = [];
		result = null;
		stage?.resetView();
	}

	function onPointer(e: StagePointer) {
		if (!calibrating || e.kind !== 'tap') return;
		taps = [...taps, { x: e.x, y: e.y }];
		if (taps.length === 4) void saveQuad(taps);
	}

	async function saveQuad(quad: Pt[]) {
		const r = boardHomography(quad, rows, cols);
		calibrating = false;
		taps = [];
		if (!r?.valid) {
			toast(r?.reason ?? 'Those corners do not form a usable area. Try again.', 'warning', { label: 'Retry', run: startCalibration });
			return;
		}
		await ws.commit('Set assembly area', (d) => (d.boardQuad = quad.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))));
		toast('Assembly area set. Ghost outlines now show where each piece goes.', 'success');
	}

	function clearQuad() {
		void ws.commit('Switch to 2D guidance', (d) => (d.boardQuad = undefined));
	}

	async function useSampleFrame() {
		if (doc?.sample?.boardQuad) await saveQuad(doc.sample.boardQuad);
	}

	let confirming = false;
	async function confirm(source: 'vision' | 'manual', evidence?: PlacementRecord['evidence']) {
		if (!step || !piece || confirming) return;
		confirming = true;
		const s = step;
		const label = pieceLabel(piece.label);
		let finished = false;
		try {
			await ws.commit(`Place ${label}`, (d) => {
				// decide completion from the document itself, not from a possibly stale count
				if (!d.placements.some((p) => p.pieceId === s.pieceId)) {
					d.placements.push({ id: crypto.randomUUID(), pieceId: s.pieceId, row: s.row, col: s.col, rot: s.rot, source, evidence, at: Date.now() });
				}
				d.skipped = d.skipped.filter((x) => x !== s.pieceId);
				if (d.placements.length >= total) {
					d.state = 'COMPLETED';
					d.completedAt = Date.now();
					finished = true;
				}
			});
		} finally {
			confirming = false;
		}
		result = null;
		if (finished) await goto(`/p/${ws.id}/done`);
		else toast(source === 'manual' ? `${label} placed · confirmed by you.` : `${label} verified from the photo.`, 'success', { label: 'Undo', run: () => ws.undo() }, 3000);
	}

	// every cell filled but not marked complete (e.g. after a reload): finish up
	$effect(() => {
		if (doc && cand && !step && doc.state === 'GUIDING' && doc.placements.length >= total && total > 0) {
			void ws.commit('Finish', (d) => ((d.state = 'COMPLETED'), (d.completedAt ??= Date.now())), { undoable: false }).then(() => goto(`/p/${ws.id}/done`));
		}
	});

	function skip() {
		if (!step || !piece) return;
		const id = step.pieceId;
		void ws.commit(`Skip ${pieceLabel(piece.label)}`, (d) => {
			if (!d.skipped.includes(id)) d.skipped.push(id);
		});
	}

	async function runVerify(after: { pixels: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }; url?: string }, simulated: boolean) {
		if (!doc?.photo || !step || !piece || !geom) return;
		const key = `check:${++checkSeq}`;
		await ws.ensurePhoto();
		await vision.loadImage(key, after.pixels);
		const r = await vision.verify({
			beforeKey: `photo:${doc.photo.mediaId}`,
			afterKey: key,
			mask: doc.masks[piece.maskKey],
			corners: geom.corners,
			row: step.row,
			col: step.col,
			rot: step.rot,
			board: H ?? undefined,
			allMasks: ws.pieces.map((p) => doc.masks[p.maskKey]),
			boardQuad: doc.boardQuad
		});
		result = { ...r, photoUrl: after.url, simulated };
		if (r.status === 'verified') {
			// let the person see the verified photo before moving on
			await new Promise((res) => setTimeout(res, 2400));
			await confirm('vision', r.evidence);
		}
	}

	async function checkPlacement() {
		if (!doc?.photo || !step || checking) return;
		checking = true;
		result = null;
		try {
			if (isSample) {
				if (!H) {
					toast('Set the assembly area first so the photo can be checked.', 'info');
					return;
				}
				const sim = await simulatePhoto(
					sampleUrl('background.jpg'),
					doc.photo.width,
					doc.photo.height,
					items.map((it) => ({
						cutout: it.cutout,
						mask: it.mask,
						geom: it.geom,
						placedAt: placedIds.has(it.placement.pieceId) || it.placement.pieceId === step.pieceId ? it.placement : null
					})),
					H
				);
				await runVerify(sim, true);
			} else if (view === 'camera' && cam && camReady) {
				const frame = await cam.grab();
				await runVerify(await toPhotoFrame(frame), false);
			} else {
				fileInput?.click();
			}
		} catch (err) {
			toast((err as Error).message || 'Could not check the photo.', 'error');
		} finally {
			checking = false;
		}
	}

	/** Brings a new still to the first photo's size so the two can be compared pixel to pixel. */
	async function toPhotoFrame(src: Blob | ImageBitmap) {
		const n = await normalizePhoto(src);
		const W = doc!.photo!.width;
		const Hh = doc!.photo!.height;
		const sameAspect = Math.abs(n.bitmap.width / n.bitmap.height - W / Hh) < 0.02;
		if (!sameAspect) toast('This photo is framed differently from the first one, so the check may fail. Keep the camera fixed.', 'warning');
		const c = new OffscreenCanvas(W, Hh);
		c.getContext('2d')!.drawImage(n.bitmap, 0, 0, W, Hh);
		const pixels = await bitmapToPixels(await createImageBitmap(c));
		return { pixels, url: URL.createObjectURL(n.blob) };
	}

	async function onFile(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0];
		(e.currentTarget as HTMLInputElement).value = '';
		if (!f) return;
		checking = true;
		try {
			await runVerify(await toPhotoFrame(f), false);
		} catch {
			toast('We could not read that photo.', 'error');
		} finally {
			checking = false;
		}
	}

	function onKey(e: KeyboardEvent) {
		if ((e.target as HTMLElement).closest('input, select, textarea')) return;
		if (e.key === 'Escape') {
			calibrating = false;
			taps = [];
			result = null;
		} else if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button')) void checkPlacement();
	}

	const ghost = $derived(H && geom && step && piece && doc ? { m: ghostMatrix(H, geom, step), url: ws.cutout(piece) ? cutoutUrl(ws.cutout(piece)!) : '', mask: doc.masks[piece.maskKey], outline: outlineInImage(geom, step, H) } : null);
	const placedGhosts = $derived.by(() => {
		if (!H || !cand) return [];
		return items.filter((it) => placedIds.has(it.placement.pieceId)).map((it) => outlineInImage(it.geom, it.placement, H));
	});
	const gridLines = $derived.by(() => {
		if (!H) return [];
		const lines: Pt[][] = [];
		for (let r = 0; r <= rows; r++) lines.push([applyH(H, { x: 0, y: r }), applyH(H, { x: cols, y: r })]);
		for (let c = 0; c <= cols; c++) lines.push([applyH(H, { x: c, y: 0 }), applyH(H, { x: c, y: rows })]);
		return lines;
	});
	const statusMeta = {
		verified: { cls: 'bg-verified-soft border-verified/30', icon: Check, title: 'Verified from the photo', tone: 'text-verified' },
		needs_confirmation: { cls: 'bg-amber-soft border-amber/30', icon: TriangleAlert, title: 'Looks close — confirm manually', tone: 'text-amber-ink' },
		not_detected: { cls: 'bg-error-soft border-error/25', icon: CircleAlert, title: 'We can’t confirm this placement from the photo', tone: 'text-error' }
	};
	const cornerNames = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><title>{piece ? `Find ${pieceLabel(piece.label)}` : 'Assemble'} · PuzzleAR</title></svelte:head>

<input bind:this={fileInput} type="file" accept="image/*" capture="environment" class="hidden" onchange={onFile} />

<AppBar {ws} step={4} />

{#snippet boardOverlay()}
	{#if H}
		<g pointer-events="none">
			{#each gridLines as l, i (i)}
				<line x1={l[0].x} y1={l[0].y} x2={l[1].x} y2={l[1].y} stroke="#fff" stroke-opacity="0.55" stroke-width="1.25" stroke-dasharray="6 6" vector-effect="non-scaling-stroke" />
			{/each}
			{#each placedGhosts as o, i (i)}
				<path d={svgPath(o)} fill="#247B56" fill-opacity="0.18" stroke="#c9f0dc" stroke-width="1.5" vector-effect="non-scaling-stroke" />
			{/each}
			{#if ghost}
				<image href={ghost.url} x={ghost.mask.left} y={ghost.mask.top} width={ghost.mask.width} height={ghost.mask.height} opacity="0.6" transform="matrix({ghost.m.a} {ghost.m.b} {ghost.m.c} {ghost.m.d} {ghost.m.e} {ghost.m.f})" />
				<path d={svgPath(ghost.outline)} fill="none" stroke="#fff" stroke-width="2.5" stroke-dasharray="7 5" vector-effect="non-scaling-stroke" style="animation: breathe 1.6s ease-in-out infinite" />
			{/if}
		</g>
	{/if}
{/snippet}

{#if doc && cand}
	<main id="main" class="mx-auto grid max-w-[1440px] gap-5 px-4 pt-4 pb-36 lg:grid-cols-[58fr_42fr] lg:px-6 lg:pb-8">
		{#if step && piece}
			<div class="card flex items-center gap-3 p-3 lg:hidden" aria-live="polite">
				<div class="bg-ground-deep grid size-16 shrink-0 place-items-center rounded-[10px]">
					<PieceThumb cutout={ws.cutout(piece)} mask={doc.masks[piece.maskKey]} {geom} rot={step.rot} size={60} />
				</div>
				<div class="min-w-0">
					<p class="text-muted tabular text-[0.75rem] font-medium">Step {done.length + 1} of {total}</p>
					<p class="text-[1.125rem] leading-6 font-semibold tracking-[-0.02em]">Find Piece {pieceLabel(piece.label)}</p>
					<p class="text-[0.875rem] font-medium">→ Row {step.row + 1} · Column {step.col + 1}</p>
				</div>
			</div>
		{/if}
		<section class="flex min-w-0 flex-col gap-3" aria-label="Your table">
			<div class="flex flex-wrap items-center gap-2">
				<div class="card flex p-1" role="tablist" aria-label="Left view">
					<button role="tab" aria-selected={view === 'photo'} class="btn btn-sm {view === 'photo' ? 'bg-ink text-white hover:bg-ink' : 'btn-ghost'}" onclick={() => (cam?.stop(), (view = 'photo'))}><ScanLine class="size-4" /> Photo</button>
					<button role="tab" aria-selected={view === 'camera'} class="btn btn-sm {view === 'camera' ? 'bg-ink text-white hover:bg-ink' : 'btn-ghost'}" onclick={() => (view = 'camera')} disabled={isSample} title={isSample ? 'The sample uses its photo' : 'Live camera with overlay'}><Video class="size-4" /> Live camera</button>
				</div>
				{#if H}
					<button class="btn btn-secondary btn-sm" onclick={startCalibration}><SquareDashed class="size-4" /> Recalibrate</button>
					<button class="btn btn-quiet btn-sm" onclick={clearQuad}><LayoutGrid class="size-4" /> Switch to 2D</button>
				{:else if !calibrating}
					<button class="btn btn-secondary btn-sm" onclick={startCalibration}><SquareDashed class="size-4" /> Set assembly area</button>
					{#if doc.sample?.boardQuad}<button class="btn btn-quiet btn-sm" onclick={useSampleFrame}>Use the marked frame</button>{/if}
				{/if}
				{#if H}<p class="text-muted ml-auto text-[0.8125rem] max-xl:hidden">If you move your camera, recalibrate.</p>{/if}
			</div>

			<div class="relative">
				{#if view === 'camera'}
					<CameraView bind:this={cam} bind:ready={camReady} class="h-[50vh] min-h-[300px] lg:h-[calc(100vh-11.5rem)]" onerror={(_, m) => (toast(m, 'warning'), (view = 'photo'))}>
						{#snippet overlay({ width })}
							<g transform="scale({width / (doc.photo?.width ?? width)})">
								{@render boardOverlay()}
							</g>
						{/snippet}
					</CameraView>
				{:else}
					<PhotoStage
						bind:this={stage}
						src={result?.photoUrl ?? doc.photo?.url}
						width={doc.photo?.width ?? 1600}
						height={doc.photo?.height ?? 1200}
						class="lg:h-[calc(100vh-11.5rem)]"
						onpointer={onPointer}
						cursor={calibrating ? 'crosshair' : 'default'}
						pan={!calibrating}
					>
						{#if !result?.photoUrl}<PieceOverlay items={overlay()} />{/if}
						{@render boardOverlay()}
						{#each taps as t, i (i)}
							<g style="transform: translate({t.x}px, {t.y}px) scale(calc(1 / var(--z)))">
								<circle r="9" fill="#167A6B" stroke="#fff" stroke-width="2.5" />
								<text y="4" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">{i + 1}</text>
							</g>
						{/each}
						{#if taps.length > 1}
							<polyline points={taps.map((t) => `${t.x},${t.y}`).join(' ')} fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" />
						{/if}
					</PhotoStage>
				{/if}
				{#if calibrating}
					<div class="absolute inset-x-3 top-3 flex justify-center" role="status">
						<div class="flex items-center gap-3 rounded-full bg-[#1f2a25]/90 py-1.5 pr-1.5 pl-4 text-[0.875rem] text-white shadow-lg backdrop-blur">
							<span>Tap the <strong>{cornerNames[taps.length]}</strong> corner of the empty assembly area ({taps.length + 1} of 4)</span>
							<button class="rounded-full bg-white/15 px-3 py-1 font-medium hover:bg-white/25" onclick={() => ((calibrating = false), (taps = []))}>Cancel</button>
						</div>
					</div>
				{:else if result?.photoUrl}
					<div class="absolute inset-x-3 top-3 flex justify-center">
						<div class="flex items-center gap-2 rounded-full bg-[#1f2a25]/90 py-1.5 pr-1.5 pl-4 text-[0.8125rem] text-white shadow-lg backdrop-blur">
							<span>{result.simulated ? 'Simulated check photo (sample session)' : 'Your check photo'}</span>
							<button class="rounded-full bg-white/15 px-3 py-1 font-medium hover:bg-white/25" onclick={() => (result = result ? { ...result, photoUrl: undefined } : null)}>Show original</button>
						</div>
					</div>
				{/if}
			</div>
		</section>

		<aside class="flex flex-col gap-4 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto" aria-label="Current step">
			{#if step && piece}
				<div class="card p-5 max-lg:hidden">
					<p class="text-muted tabular text-[0.8125rem] font-medium">Step {done.length + 1} of {total}</p>
					<div class="mt-3 flex items-center gap-4">
						<div class="bg-ground-deep grid size-[112px] shrink-0 place-items-center rounded-[14px]">
							<PieceThumb cutout={ws.cutout(piece)} mask={doc.masks[piece.maskKey]} {geom} rot={step.rot} size={104} />
						</div>
						<div class="min-w-0">
							<h1 class="text-[1.625rem] leading-8 font-semibold tracking-[-0.025em]">Find Piece {pieceLabel(piece.label)}</h1>
							<p class="mt-1 flex items-center gap-1.5 text-[1.0625rem] font-medium">
								<ArrowRight class="text-teal size-[18px]" aria-hidden="true" />
								Place at Row {step.row + 1} · Column {step.col + 1}
							</p>
							<p class="text-muted mt-1 text-[0.8125rem]">Turn it so it looks like the picture.</p>
						</div>
					</div>
					{#if stepEdges.length}
						<ul class="mt-4 grid gap-1.5">
							{#each stepEdges as e (e.dir)}
								{@const nb = ws.pieceById(e.neighbour.pieceId)}
								<li class="flex flex-wrap items-center gap-2 text-[0.875rem]">
									<span>Joins {pieceLabel(nb?.label ?? 0)} on its {SIDE_NAMES[e.dir]}</span>
									{#if e.edge}<ConfidenceChip value={e.edge.confidence} />{/if}
								</li>
							{/each}
						</ul>
					{/if}
					{#if doc.skipped.includes(step.pieceId)}
						<p class="text-amber-ink mt-3 text-[0.8125rem]">You skipped this one earlier.</p>
					{/if}
				</div>

				{#if result}
					{@const m = statusMeta[result.status]}
					<div class="rounded-[16px] border p-4 {m.cls}" role="status" aria-live="polite" style="animation: rise 220ms var(--ease-out-expo) both">
						<div class="flex items-start gap-3">
							<m.icon class="mt-0.5 size-5 shrink-0 {m.tone}" />
							<div class="min-w-0 flex-1">
								<p class="font-semibold {m.tone}">{result.evidence.boardMoved ? 'Your camera seems to have moved.' : m.title}</p>
								<p class="text-ink/80 mt-0.5 text-[0.875rem]">{result.reason}</p>
								<p class="text-muted tabular mt-2 text-[0.75rem]">
									Source spot {result.evidence.sourceVacated ? 'empty' : 'still occupied'}{result.evidence.targetMatch !== undefined ? ` · target pattern match ${result.evidence.targetMatch.toFixed(2)}` : ''}
								</p>
							</div>
							<button class="text-muted hover:text-ink rounded p-0.5" aria-label="Dismiss" onclick={() => (result = null)}><X class="size-4" /></button>
						</div>
						{#if result.status !== 'verified'}
							<div class="mt-3 flex flex-wrap gap-2">
								<button class="btn btn-primary btn-sm" onclick={() => confirm('manual', result?.evidence)}><Hand class="size-4" /> I placed it</button>
								<button class="btn btn-secondary btn-sm" onclick={checkPlacement}>Try again</button>
								{#if result.evidence.boardMoved}
									<button class="btn btn-secondary btn-sm" onclick={startCalibration}>Recalibrate</button>
									<button class="btn btn-quiet btn-sm" onclick={clearQuad}>Switch to 2D</button>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<div class="card p-4 sm:p-5">
					<div class="flex items-baseline justify-between">
						<h2 class="label">Board · {done.length} of {total} placed</h2>
						<a class="text-teal text-[0.8125rem] font-medium hover:underline" href="/p/{ws.id}/solve">View alternatives</a>
					</div>
					<div class="mx-auto mt-2 max-w-[340px]">
						<BoardView {rows} {cols} {items} faded={unplaced} target={{ row: step.row, col: step.col }} kraft />
					</div>
					{#if !H}
						<p class="text-muted mt-3 text-[0.8125rem] leading-5">
							2D guidance: find the white-outlined piece on the left and place it in the highlighted cell. Set an assembly area to see ghost outlines on your table.
						</p>
					{/if}
				</div>

				<div class="lg:bg-ground max-lg:bg-ground/95 max-lg:border-line grid gap-2 lg:sticky lg:bottom-0 lg:z-10 lg:pt-2 lg:pb-1 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:border-t max-lg:px-4 max-lg:pt-3 max-lg:pb-[calc(env(safe-area-inset-bottom)+12px)] max-lg:backdrop-blur-md">
					<button class="btn btn-primary h-12 text-base" onclick={checkPlacement} disabled={checking || calibrating || (isSample && !H)} title={isSample && !H ? 'Set the assembly area first' : ''}>
						{#if view === 'camera' && !isSample}<Camera class="size-[18px]" />{:else if isSample}<ScanLine class="size-[18px]" />{:else}<ImageUp class="size-[18px]" />{/if}
						{checking ? 'Checking…' : isSample ? 'Check Placement (simulated photo)' : 'Check Placement'}
					</button>
					<div class="grid grid-cols-[1fr_auto_auto] gap-2">
						<button class="btn btn-secondary" onclick={() => confirm('manual')} disabled={checking}><Hand class="size-4" /> I placed it</button>
						<button class="btn btn-secondary" onclick={skip} disabled={checking || total - done.length < 2} aria-label="Skip this piece for now"><SkipForward class="size-4" /><span class="max-sm:sr-only">Skip</span></button>
						<button class="btn btn-secondary" onclick={() => ws.undo()} disabled={!ws.canUndo} aria-label="Undo"><Undo2 class="size-4" /><span class="max-sm:sr-only">Undo</span></button>
					</div>
					{#if isSample && !H}
						<p class="text-muted text-center text-[0.75rem]">In the sample, set the assembly area to try photo checks.</p>
					{/if}
				</div>
			{:else}
				<div class="card p-6 text-center">
					<p class="font-semibold">Every piece is placed.</p>
					<a class="btn btn-primary mt-4" href="/p/{ws.id}/done">See the result <ArrowRight class="size-4" /></a>
				</div>
			{/if}
		</aside>
	</main>
{/if}
