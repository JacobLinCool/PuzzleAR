<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, CircleAlert, Hand, RefreshCcw, RotateCw, ThumbsDown, ThumbsUp, X } from '@lucide/svelte';
	import AppBar from '$lib/components/AppBar.svelte';
	import BoardView, { type BoardEdgeMark } from '$lib/components/BoardView.svelte';
	import ConfidenceChip from '$lib/components/ConfidenceChip.svelte';
	import EdgeCompare from '$lib/components/EdgeCompare.svelte';
	import PhotoStage from '$lib/components/PhotoStage.svelte';
	import PieceOverlay, { type OverlayItem } from '$lib/components/PieceOverlay.svelte';
	import PieceThumb from '$lib/components/PieceThumb.svelte';
	import { cellEdges, cellOf, SIDE_NAMES } from '$lib/client/puzzle';
	import type { BoardItem } from '$lib/client/render';
	import { solutionIsCurrent, solvePuzzle } from '$lib/client/solving';
	import { toast } from '$lib/client/toasts.svelte';
	import { pieceLabel, Workspace } from '$lib/client/workspace.svelte';
	import { activeCandidate, edgeKey, type CandidatePlacement } from '$lib/shared/doc';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const ws = $derived(Workspace.get(data.id));
	const doc = $derived(ws.doc);

	let solving = $state(false);
	let failure = $state<{ code: string; message: string } | null>(null);
	let sel = $state<{ row: number; col: number } | null>(null);

	const act = $derived(doc ? activeCandidate(doc) : undefined);
	const cand = $derived(act?.candidate);
	const solution = $derived(act?.solution);
	const optionCount = $derived(solution?.candidates.length ?? 0);
	const optionIndex = $derived(doc?.active?.index ?? 0);
	const checkCount = $derived(cand?.edges.filter((e) => e.confidence === 'check').length ?? 0);

	// solve on arrival when there is no current solution
	let started = false;
	$effect(() => {
		if (!doc || started || !ws.photo) return;
		if (!doc.grid) {
			started = true;
			void goto(`/p/${ws.id}/review`, { replaceState: true });
			return;
		}
		if (doc.state === 'SOLVING' || !solutionIsCurrent(ws)) {
			started = true;
			void resolve('Find matches');
		} else started = true;
	});

	async function resolve(label: string) {
		solving = true;
		failure = null;
		try {
			const out = await solvePuzzle(ws);
			if (!out.ok) {
				failure = { code: out.code, message: out.message };
				return;
			}
			await ws.commit(
				label,
				(d) => {
					d.solutions = [...d.solutions.slice(-2), out.solution];
					d.active = { solutionId: out.solution.id, index: 0 };
					if (d.state === 'SOLVING' || d.state === 'REVIEW') d.state = 'SOLUTION_READY';
				},
				{ undoable: label !== 'Find matches' }
			);
		} finally {
			solving = false;
		}
	}

	function setOption(i: number) {
		if (!solution || i < 0 || i >= optionCount) return;
		void ws.commit(`Option ${i + 1}`, (d) => (d.active = { solutionId: solution.id, index: i }));
	}

	const items = $derived.by((): BoardItem[] => {
		if (!cand || !doc || !ws.photo) return [];
		const out: BoardItem[] = [];
		for (const p of cand.placements) {
			const piece = ws.pieceById(p.pieceId);
			if (!piece) continue;
			const geom = ws.geom(piece);
			const cutout = ws.cutout(piece);
			if (geom && cutout) out.push({ placement: p, geom, mask: doc.masks[piece.maskKey], cutout });
		}
		return out;
	});

	const marks = $derived.by((): BoardEdgeMark[] => {
		if (!cand) return [];
		const out: BoardEdgeMark[] = [];
		for (const e of cand.edges) {
			const pa = cand.placements.find((p) => p.pieceId === e.a)!;
			const pb = cand.placements.find((p) => p.pieceId === e.b)!;
			if (!pa || !pb) continue;
			const first = pa.row < pb.row || (pa.row === pb.row && pa.col < pb.col) ? pa : pb;
			const dir = pa.row === pb.row ? 1 : 2;
			out.push({ row: first.row, col: first.col, dir, confidence: e.confidence });
		}
		return out;
	});

	const selPlacement = $derived(cand && sel ? cellOf(cand.placements, sel.row, sel.col) : undefined);
	const selPiece = $derived(selPlacement ? ws.pieceById(selPlacement.pieceId) : undefined);
	const selEdges = $derived(cand && selPlacement ? cellEdges(cand.placements, cand.edges, selPlacement) : []);
	const highlightIds = $derived(new Set(selEdges.map((e) => e.neighbour.pieceId)));

	function overlay(): OverlayItem[] {
		if (!doc) return [];
		return ws.pieces.map((p) => {
			const g = ws.geom(p);
			const tone: OverlayItem['tone'] = !selPiece ? 'default' : p.id === selPiece.id ? 'selected' : highlightIds.has(p.id) ? 'neighbour' : 'dim';
			return { id: p.id, label: p.label, outline: g?.outline ?? [], centroid: g?.centroid ?? { x: 0, y: 0 }, tone };
		});
	}

	function cellLabel(r: number, c: number) {
		const p = cand && cellOf(cand.placements, r, c);
		const piece = p && ws.pieceById(p.pieceId);
		return piece ? `Row ${r + 1}, column ${c + 1}: piece ${pieceLabel(piece.label)}` : `Row ${r + 1}, column ${c + 1}`;
	}

	async function addConstraint(type: 'fits' | 'doesnt_fit', e: (typeof selEdges)[number]) {
		if (!selPlacement || !doc) return;
		const a = selPlacement.pieceId;
		const b = e.neighbour.pieceId;
		const la = pieceLabel(ws.pieceById(a)!.label);
		const lb = pieceLabel(ws.pieceById(b)!.label);
		await ws.commit(type === 'fits' ? `${la} fits ${lb}` : `${la} doesn't fit ${lb}`, (d) => {
			d.constraints = d.constraints.filter((c) => !(edgeKey(c.pieceA, c.sideA, c.pieceB, c.sideB) === edgeKey(a, e.side, b, e.neighbourSide)));
			d.constraints.push({ id: crypto.randomUUID(), type, pieceA: a, sideA: e.side, pieceB: b, sideB: e.neighbourSide, at: Date.now() });
			if (d.state === 'SOLUTION_READY') d.state = 'SOLVING';
		});
		await resolve(type === 'fits' ? 'Re-solve with fit' : 'Re-solve without that pair');
		if (doc.state === 'SOLVING') await ws.commit('Solved', (d) => (d.state = 'SOLUTION_READY'), { undoable: false });
		toast(type === 'fits' ? `Locked ${la} with ${lb}. The board was re-solved around it.` : `Noted: ${la} and ${lb} don't fit. The board was re-solved.`, 'success', { label: 'Undo', run: () => ws.undo() });
	}

	async function removeConstraint(id: string) {
		await ws.commit('Remove a confirmation', (d) => (d.constraints = d.constraints.filter((c) => c.id !== id)));
		await resolve('Re-solve');
	}

	/**
	 * Without a box image all four turns of a board are equally valid, so the
	 * person can turn it to match the table (square boards 90°, others 180°).
	 */
	function turnBoard() {
		if (!doc || !solution || !doc.active || doc.placements.length) return;
		const R = solution.rows;
		const C = solution.cols;
		const square = R === C;
		const idx = doc.active.index;
		const solId = solution.id;
		void ws.commit('Turn board', (d) => {
			const c = d.solutions.find((x) => x.id === solId)!.candidates[idx];
			c.placements = c.placements.map((p) =>
				square
					? { ...p, row: p.col, col: R - 1 - p.row, rot: ((p.rot + 1) % 4) as 0 | 1 | 2 | 3 }
					: { ...p, row: R - 1 - p.row, col: C - 1 - p.col, rot: ((p.rot + 2) % 4) as 0 | 1 | 2 | 3 }
			);
		}, { undoable: false });
		sel = null;
	}

	async function start() {
		await ws.commit('Start assembling', (d) => {
			d.state = 'GUIDING';
			d.guideStartedAt ??= Date.now();
		});
		await goto(`/p/${ws.id}/guide`);
	}

	function onKey(e: KeyboardEvent) {
		if ((e.target as HTMLElement).closest('input, select, textarea')) return;
		if (e.key === 'ArrowRight' && !sel) setOption(optionIndex + 1);
		else if (e.key === 'ArrowLeft' && !sel) setOption(optionIndex - 1);
		else if (e.key === 'Escape') sel = null;
		else if (e.key === 'Enter' && cand && !solving && !(e.target as HTMLElement).closest('button')) void start();
	}

	function firstCheck() {
		if (!cand) return;
		const e = cand.edges.find((x) => x.confidence === 'check');
		const p = e && cand.placements.find((x) => x.pieceId === e.a);
		if (p) sel = { row: p.row, col: p.col };
	}

	const sideWord = (p: CandidatePlacement | undefined, dir: number) => (p ? SIDE_NAMES[dir] : '');
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><title>Find the fit · PuzzleAR</title></svelte:head>

<AppBar {ws} step={3} />

{#if doc}
	<main id="main" class="mx-auto max-w-[1440px] px-4 pt-4 pb-32 lg:px-6 lg:pb-10">
		<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
			<h1 class="text-h2 font-semibold tracking-[-0.02em]">Proposed board</h1>
			{#if cand && optionCount}
				<div class="card flex items-center gap-1 p-1" role="group" aria-label="Board options">
					<button class="btn btn-ghost btn-sm size-9 !px-0" aria-label="Previous option" disabled={optionIndex === 0 || solving} onclick={() => setOption(optionIndex - 1)}><ChevronLeft class="size-4" /></button>
					<span class="tabular px-1 text-[0.875rem] font-semibold" aria-live="polite">Option {optionIndex + 1} of {optionCount}</span>
					<button class="btn btn-ghost btn-sm size-9 !px-0" aria-label="Next option" disabled={optionIndex >= optionCount - 1 || solving} onclick={() => setOption(optionIndex + 1)}><ChevronRight class="size-4" /></button>
				</div>
				{#if checkCount}
					<button class="chip bg-amber-soft text-amber-ink hover:bg-[#f3e2c8]" onclick={firstCheck}>
						Some edges need a closer look · {checkCount}
					</button>
				{:else}
					<span class="chip bg-teal-soft text-teal">Every edge is a strong candidate or confirmed</span>
				{/if}
				{#if solution?.relaxed}
					<span class="chip bg-amber-soft text-amber-ink" title="Some pieces' flat sides did not fit the frame; the solver allowed it with a penalty">Edges relaxed to complete the board</span>
				{/if}
			{/if}
			{#if cand && !doc.placements.length}
				<button class="btn btn-secondary btn-sm" onclick={turnBoard} disabled={solving} title="All turns of the board fit equally; turn it to match your table"><RotateCw class="size-4" /> Turn board</button>
			{/if}
			<p class="text-muted ml-auto text-[0.8125rem] max-md:hidden"><span class="kbd">←</span> <span class="kbd">→</span> options · <span class="kbd">Enter</span> start</p>
		</div>

		{#if failure}
			<div class="card border-error/30 mt-4 flex flex-wrap items-start gap-3 p-5" role="alert">
				<CircleAlert class="text-error mt-0.5 size-5 shrink-0" />
				<div class="min-w-0 flex-1">
					<p class="font-semibold">{failure.code === 'NO_FEASIBLE_SOLUTION' ? 'These confirmations conflict.' : 'We could not build a board yet.'}</p>
					<p class="text-muted mt-1">{failure.message}</p>
				</div>
				<div class="flex gap-2">
					{#if ws.canUndo}<button class="btn btn-secondary btn-sm" onclick={() => ws.undo()}>Undo last change</button>{/if}
					<a class="btn btn-secondary btn-sm" href="/p/{ws.id}/review"><ArrowLeft class="size-4" /> Back to review</a>
				</div>
			</div>
		{/if}

		<div class="mt-4 grid gap-5 lg:grid-cols-2">
			<section aria-labelledby="scanned-h" class="min-w-0">
				<h2 id="scanned-h" class="label mb-2">Scanned pieces</h2>
				<PhotoStage
					src={doc.photo?.url}
					width={doc.photo?.width ?? 1600}
					height={doc.photo?.height ?? 1200}
					class="lg:h-[calc(100vh-13rem)]"
					dim={!!selPiece}
				>
					<PieceOverlay items={overlay()} />
				</PhotoStage>
			</section>

			<section aria-labelledby="board-h" class="flex min-w-0 flex-col gap-4">
				<div class="card relative p-4 sm:p-5">
					<h2 id="board-h" class="label">Tap a cell to see why it's there</h2>
					{#if solving && !cand}
						<div class="grid aspect-square place-items-center" role="status">
							<p class="text-muted" style="animation: breathe 1.4s ease-in-out infinite">Searching matches…</p>
						</div>
					{:else if cand && solution}
						<div class="mx-auto mt-2 max-w-[560px] transition-opacity duration-200 {solving ? 'opacity-50' : ''}">
							<BoardView
								rows={solution.rows}
								cols={solution.cols}
								{items}
								edges={marks}
								showEdges
								selected={sel ?? undefined}
								oncell={(r, c) => (sel = sel?.row === r && sel?.col === c ? null : { row: r, col: c })}
								{cellLabel}
							/>
						</div>
						<div class="text-muted mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[0.75rem]">
							<span class="flex items-center gap-1.5"><span class="bg-teal h-0.5 w-4 rounded"></span>Strong candidate</span>
							<span class="flex items-center gap-1.5"><span class="border-amber h-0 w-4 border-t-2 border-dashed"></span>Needs a check</span>
							<span class="flex items-center gap-1.5"><span class="bg-verified h-0.5 w-4 rounded"></span>Human-confirmed</span>
						</div>
					{/if}
					{#if solving && cand}
						<p class="text-muted absolute top-4 right-5 text-[0.8125rem]" role="status" style="animation: breathe 1.4s ease-in-out infinite">Re-solving…</p>
					{/if}
				</div>

				{#if selPlacement && selPiece}
					<div class="card p-5" style="animation: rise 200ms var(--ease-out-expo) both">
						<div class="flex items-center gap-4">
							<div class="bg-ground-deep grid size-[84px] shrink-0 place-items-center rounded-[12px]">
								<PieceThumb cutout={ws.cutout(selPiece)} mask={doc.masks[selPiece.maskKey]} geom={ws.geom(selPiece)} rot={selPlacement.rot} size={80} />
							</div>
							<div class="flex-1">
								<p class="flex items-center gap-2"><span class="piece-tag">{pieceLabel(selPiece.label)}</span> <span class="text-muted text-[0.875rem]">Row {selPlacement.row + 1}, column {selPlacement.col + 1}</span></p>
								<p class="text-muted mt-1.5 text-[0.875rem]">A quick physical check will help: hold the two pieces together, then tell us.</p>
							</div>
							<button class="btn btn-quiet size-10 !px-0" aria-label="Close" onclick={() => (sel = null)}><X class="size-4" /></button>
						</div>
						<ul class="mt-4 grid gap-4">
							{#each selEdges as e (e.dir)}
								{@const nbPiece = ws.pieceById(e.neighbour.pieceId)}
								{@const ga = ws.geom(selPiece)}
								{@const gb = nbPiece && ws.geom(nbPiece)}
								{@const confirmed = doc.constraints.find((c) => c.type === 'fits' && edgeKey(c.pieceA, c.sideA, c.pieceB, c.sideB) === edgeKey(selPiece.id, e.side, e.neighbour.pieceId, e.neighbourSide))}
								<li class="border-line rounded-[12px] border p-3.5">
									<div class="mb-2.5 flex flex-wrap items-center gap-2">
										<p class="text-[0.9375rem] font-semibold">{sideWord(selPlacement, e.dir)[0].toUpperCase() + sideWord(selPlacement, e.dir).slice(1)} · {nbPiece ? pieceLabel(nbPiece.label) : ''}</p>
										{#if e.edge}<ConfidenceChip value={e.edge.confidence} />{/if}
									</div>
									{#if ga && gb}
										<EdgeCompare a={ga.sides[e.side]} b={gb.sides[e.neighbourSide]} scores={solution?.scores?.[edgeKey(selPiece.id, e.side, e.neighbour.pieceId, e.neighbourSide)]} labelA={pieceLabel(selPiece.label)} labelB={pieceLabel(nbPiece!.label)} />
									{/if}
									{#if e.edge}<p class="text-muted mt-2 text-[0.8125rem]">{e.edge.reason}</p>{/if}
									<div class="mt-3 flex gap-2">
										{#if confirmed}
											<p class="text-verified flex items-center gap-1.5 text-[0.875rem] font-medium"><Check class="size-4" /> You confirmed this fit</p>
											<button class="btn btn-quiet btn-sm ml-auto" onclick={() => removeConstraint(confirmed.id)} disabled={solving}>Undo confirmation</button>
										{:else}
											<button class="btn btn-secondary btn-sm flex-1" disabled={solving} onclick={() => addConstraint('fits', e)}><ThumbsUp class="size-4" /> Fits</button>
											<button class="btn btn-secondary btn-sm flex-1" disabled={solving} onclick={() => addConstraint('doesnt_fit', e)}><ThumbsDown class="size-4" /> Doesn't fit</button>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					</div>
				{:else if cand}
					<div class="card text-muted flex items-start gap-3 p-5 text-[0.9375rem]">
						<Hand class="text-teal mt-0.5 size-5 shrink-0" />
						<p>The board is built from the real textures in your photo. Amber dashed marks are edges worth trying on the table first. Tell us <strong class="text-ink">Fits</strong> or <strong class="text-ink">Doesn't fit</strong> and the solver keeps your answer from then on.</p>
					</div>
				{/if}

				{#if doc.constraints.length}
					<div class="card p-5">
						<h2 class="label">Your confirmations</h2>
						<ul class="mt-2 divide-line divide-y">
							{#each doc.constraints as c (c.id)}
								<li class="flex items-center gap-3 py-2 text-[0.875rem]">
									{#if c.type === 'fits'}<ThumbsUp class="text-verified size-4" />{:else}<ThumbsDown class="text-error size-4" />{/if}
									<span class="flex-1">{pieceLabel(ws.pieceById(c.pieceA)?.label ?? 0)} {c.type === 'fits' ? 'fits' : "doesn't fit"} {pieceLabel(ws.pieceById(c.pieceB)?.label ?? 0)}</span>
									<button class="btn btn-quiet btn-sm" onclick={() => removeConstraint(c.id)} disabled={solving}>Remove</button>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				<div class="lg:bg-ground max-lg:bg-ground/95 max-lg:border-line flex gap-2 lg:sticky lg:bottom-0 lg:z-10 lg:py-2 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:border-t max-lg:px-4 max-lg:pt-3 max-lg:pb-[calc(env(safe-area-inset-bottom)+12px)] max-lg:backdrop-blur-md">
					<button class="btn btn-secondary h-12" onclick={() => resolve('Re-solve')} disabled={solving} title="Search again"><RefreshCcw class="size-4" /><span class="max-sm:sr-only">Search again</span></button>
					<button class="btn btn-primary h-12 flex-1 text-base" disabled={!cand || solving} onclick={start}>Start Assembling <ArrowRight class="size-[18px]" /></button>
				</div>
			</section>
		</div>
	</main>
{/if}
