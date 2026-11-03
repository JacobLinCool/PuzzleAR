<!--
	Likely neighbours: for a partial pile (or any set that does not form a full
	rectangle) there is no board to solve, but edges that probably join can still
	be ranked and tried on the table.
-->
<script lang="ts">
	import { ArrowLeft, Check, ThumbsDown, ThumbsUp } from '@lucide/svelte';
	import AppBar from '$lib/components/AppBar.svelte';
	import ConfidenceChip from '$lib/components/ConfidenceChip.svelte';
	import EdgeCompare from '$lib/components/EdgeCompare.svelte';
	import PhotoStage from '$lib/components/PhotoStage.svelte';
	import PieceOverlay, { type OverlayItem } from '$lib/components/PieceOverlay.svelte';
	import PieceThumb from '$lib/components/PieceThumb.svelte';
	import { toast } from '$lib/client/toasts.svelte';
	import { findPairs } from '$lib/client/vision.svelte';
	import { pieceLabel, Workspace } from '$lib/client/workspace.svelte';
	import { edgeKey, solveBasis, type PieceRecord } from '$lib/shared/doc';
	import type { PairCandidate } from '$lib/vision/match';
	import type { PieceGeometry } from '$lib/vision/types';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const ws = $derived(Workspace.get(data.id));
	const doc = $derived(ws.doc);

	interface Pair {
		key: string;
		a: PieceRecord;
		sideA: number;
		b: PieceRecord;
		sideB: number;
		confidence: 'strong' | 'check' | 'confirmed';
		/** both sides pick each other as best partner */
		mutual: boolean;
		parts?: PairCandidate['parts'];
	}

	let pairs = $state<Pair[]>([]);
	let loading = $state(true);
	let selected = $state<string | null>(null);
	let shown = $state(12);
	let showWeak = $state(false);

	const pieces = $derived([...ws.pieces].sort((p, q) => p.label - q.label));
	const confirmed = $derived(
		(doc?.constraints ?? [])
			.filter((c) => c.type === 'fits')
			.map((c) => ({ c, a: ws.pieceById(c.pieceA), b: ws.pieceById(c.pieceB) }))
			.filter((x): x is { c: (typeof x)['c']; a: PieceRecord; b: PieceRecord } => Boolean(x.a && x.b))
	);
	const strongCount = $derived(pairs.filter((p) => p.confidence === 'strong').length);
	const mutualCount = $derived(pairs.filter((p) => p.mutual).length);
	// most sides of a partial pile have no partner here at all: lead with pairs
	// where both sides choose each other and keep one-sided guesses folded
	const visible = $derived(showWeak ? pairs : pairs.filter((p) => p.mutual));
	const sel = $derived(pairs.find((p) => p.key === selected) ?? null);

	async function load() {
		if (!doc) return;
		loading = true;
		await ws.ensurePhoto();
		await ws.refreshGeometry();
		const geoms = pieces.map((p) => ws.geom(p));
		if (geoms.some((g) => !g)) {
			loading = false;
			return;
		}
		const index = new Map(pieces.map((p, i) => [p.id, i]));
		const sid = (piece: string, side: number) => index.get(piece)! * 4 + side;
		const forbidden = doc.constraints
			.filter((c) => index.has(c.pieceA) && index.has(c.pieceB))
			.map((c) => {
				const a = sid(c.pieceA, c.sideA);
				const b = sid(c.pieceB, c.sideB);
				return a < b ? `${a}-${b}` : `${b}-${a}`;
			});
		// sides already confirmed with a partner are settled
		const settled = new Set(
			doc.constraints.filter((c) => c.type === 'fits').flatMap((c) => [`${c.pieceA}:${c.sideA}`, `${c.pieceB}:${c.sideB}`])
		);
		const out = await findPairs({ tableKey: solveBasis(doc), geoms: geoms as PieceGeometry[], forbidden });
		pairs = out
			.map((p) => {
				const a = pieces[p.a >> 2];
				const b = pieces[p.b >> 2];
				return {
					key: edgeKey(a.id, p.a & 3, b.id, p.b & 3),
					a,
					sideA: p.a & 3,
					b,
					sideB: p.b & 3,
					confidence: (p.mutual && p.margin > 0.06 ? 'strong' : 'check') as Pair['confidence'],
					mutual: p.mutual,
					parts: p.parts
				};
			})
			.sort((x, y) => Number(y.confidence === 'strong') - Number(x.confidence === 'strong') || Number(y.mutual) - Number(x.mutual))
			.filter((p) => p.a.id !== p.b.id && !settled.has(`${p.a.id}:${p.sideA}`) && !settled.has(`${p.b.id}:${p.sideB}`));
		if (!selected) selected = pairs.find((p) => p.mutual)?.key ?? null;
		loading = false;
	}

	let started = false;
	$effect(() => {
		if (doc && ws.photo && !started) {
			started = true;
			void load();
		}
	});

	async function answer(p: Pair, type: 'fits' | 'doesnt_fit') {
		const la = pieceLabel(p.a.label);
		const lb = pieceLabel(p.b.label);
		await ws.commit(type === 'fits' ? `${la} fits ${lb}` : `${la} doesn't fit ${lb}`, (d) => {
			d.constraints = d.constraints.filter((c) => edgeKey(c.pieceA, c.sideA, c.pieceB, c.sideB) !== p.key);
			d.constraints.push({ id: crypto.randomUUID(), type, pieceA: p.a.id, sideA: p.sideA, pieceB: p.b.id, sideB: p.sideB, at: Date.now() });
		});
		toast(type === 'fits' ? `Noted: ${la} fits ${lb}.` : `Noted: ${la} and ${lb} don't fit. Looking for other partners.`, 'success', { label: 'Undo', run: () => ws.undo() }, 3000);
		const idx = visible.findIndex((x) => x.key === p.key);
		selected = null;
		await load();
		selected = visible[Math.min(idx, visible.length - 1)]?.key ?? null;
	}

	function overlay(): OverlayItem[] {
		return ws.pieces.map((p) => {
			const g = ws.geom(p);
			const tone: OverlayItem['tone'] = !sel ? 'default' : p.id === sel.a.id ? 'selected' : p.id === sel.b.id ? 'selected' : 'dim';
			return { id: p.id, label: p.label, outline: g?.outline ?? [], centroid: g?.centroid ?? { x: 0, y: 0 }, tone };
		});
	}

	function sideLine(p: PieceRecord, side: number) {
		return ws.geom(p)?.sides[side].framePts ?? [];
	}
	function mid(p: PieceRecord, side: number) {
		const f = sideLine(p, side);
		return f[Math.floor(f.length / 2)] ?? { x: 0, y: 0 };
	}

	function onKey(e: KeyboardEvent) {
		if ((e.target as HTMLElement).closest('input, select, textarea')) return;
		const i = visible.findIndex((p) => p.key === selected);
		if (e.key === 'ArrowDown' || e.key === 'ArrowRight') selected = visible[Math.min(visible.length - 1, i + 1)]?.key ?? selected;
		else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') selected = visible[Math.max(0, i - 1)]?.key ?? selected;
	}
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><title>Likely neighbours · PuzzleAR</title></svelte:head>

<AppBar {ws} step={3} />

{#if doc}
	<main id="main" class="mx-auto grid max-w-[1440px] gap-5 px-4 pt-4 pb-16 lg:grid-cols-[minmax(0,1fr)_440px] lg:px-6">
		<section class="min-w-0">
			<PhotoStage src={doc.photo?.url} width={doc.photo?.width ?? 1600} height={doc.photo?.height ?? 1200} class="lg:h-[calc(100vh-6.5rem)] lg:sticky lg:top-[4.5rem]" dim={!!sel}>
				<PieceOverlay items={overlay()} />
				{#if sel}
					{@const pa = mid(sel.a, sel.sideA)}
					{@const pb = mid(sel.b, sel.sideB)}
					<polyline points={sideLine(sel.a, sel.sideA).map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#2fb39f" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-stroke" />
					<polyline points={sideLine(sel.b, sel.sideB).map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#2fb39f" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-stroke" />
					<line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#fff" stroke-width="2.5" stroke-dasharray="8 6" vector-effect="non-scaling-stroke" />
				{/if}
				{#each confirmed as x (x.c.id)}
					{@const pa = mid(x.a, x.c.sideA)}
					{@const pb = mid(x.b, x.c.sideB)}
					<line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#9be7c4" stroke-width="2" vector-effect="non-scaling-stroke" />
				{/each}
			</PhotoStage>
		</section>

		<aside class="flex min-w-0 flex-col gap-4" aria-label="Likely neighbours">
			<div class="card p-5">
				<h1 class="text-h2 font-semibold tracking-[-0.02em]">Likely neighbours</h1>
				<p class="text-muted mt-1.5 text-[0.9375rem] leading-6">
					Without every piece of the puzzle there is no full board to solve, but some edges clearly belong together. Here are the {pieces.length} pieces' most likely joins; try each pair on the table and tell us.
				</p>
				<div class="mt-3 flex flex-wrap gap-2">
					<span class="chip bg-teal-soft text-teal">{strongCount} strong</span>
					<span class="chip bg-amber-soft text-amber-ink">{mutualCount - strongCount} worth a try</span>
					<span class="chip bg-verified-soft text-verified">{confirmed.length} confirmed</span>
				</div>
				<a href="/p/{ws.id}/review" class="btn btn-quiet btn-sm mt-3 -ml-3"><ArrowLeft class="size-4" /> Back to review</a>
			</div>

			{#if loading}
				<div class="card p-5" role="status"><p class="text-muted" style="animation: breathe 1.4s ease-in-out infinite">Comparing every edge…</p></div>
			{:else if !pairs.length}
				<div class="card text-muted p-5">No more likely pairs. Confirmed pairs stay highlighted on the photo.</div>
			{/if}

			<ul class="grid gap-3">
				{#each visible.slice(0, shown) as p (p.key)}
					{@const ga = ws.geom(p.a)}
					{@const gb = ws.geom(p.b)}
					{@const on = p.key === selected}
					<li>
						<div
							class="card cursor-pointer p-4 transition-[box-shadow,border-color] {on ? 'border-teal shadow-[0_0_0_2px_rgb(22_122_107/0.25)]' : 'hover:border-line-strong'}"
							role="button"
							tabindex="0"
							aria-pressed={on}
							onclick={() => (selected = p.key)}
							onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (selected = p.key)}
						>
							<div class="flex items-center gap-3">
								<div class="bg-ground-deep grid size-[72px] shrink-0 place-items-center rounded-[10px]">
									<PieceThumb cutout={ws.cutout(p.a)} mask={doc.masks[p.a.maskKey]} geom={ga} showSides size={68} />
								</div>
								<div class="min-w-0 flex-1 text-center">
									<p class="text-[0.9375rem] font-semibold whitespace-nowrap">{pieceLabel(p.a.label)} <span class="text-muted font-normal">side {p.sideA + 1}</span></p>
									<p class="text-muted text-[0.8125rem]">joins</p>
									<p class="text-[0.9375rem] font-semibold whitespace-nowrap">{pieceLabel(p.b.label)} <span class="text-muted font-normal">side {p.sideB + 1}</span></p>
								</div>
								<div class="bg-ground-deep grid size-[72px] shrink-0 place-items-center rounded-[10px]">
									<PieceThumb cutout={ws.cutout(p.b)} mask={doc.masks[p.b.maskKey]} geom={gb} showSides size={68} />
								</div>
							</div>
							<div class="mt-3 flex items-center justify-between gap-2">
								<ConfidenceChip value={p.confidence} />
							</div>
							{#if on && ga && gb}
								<div class="mt-3">
									<EdgeCompare a={ga.sides[p.sideA]} b={gb.sides[p.sideB]} scores={p.parts} labelA={pieceLabel(p.a.label)} labelB={pieceLabel(p.b.label)} />
								</div>
								<div class="mt-3 grid grid-cols-2 gap-2">
									<button class="btn btn-secondary btn-sm" onclick={(e) => (e.stopPropagation(), answer(p, 'fits'))}><ThumbsUp class="size-4" /> Fits</button>
									<button class="btn btn-secondary btn-sm" onclick={(e) => (e.stopPropagation(), answer(p, 'doesnt_fit'))}><ThumbsDown class="size-4" /> Doesn't fit</button>
								</div>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
			{#if visible.length > shown}
				<button class="btn btn-secondary" onclick={() => (shown += 12)}>Show more pairs</button>
			{/if}
			{#if !showWeak && pairs.length > mutualCount}
				<button class="btn btn-quiet btn-sm" onclick={() => (showWeak = true)}>
					Show {pairs.length - mutualCount} weaker guesses (one-sided matches)
				</button>
			{/if}
			{#if confirmed.length}
				<div class="card p-5">
					<h2 class="label">You confirmed</h2>
					<ul class="mt-2 grid gap-1.5">
						{#each confirmed as x (x.c.id)}
							<li class="flex items-center gap-2 text-[0.875rem]"><Check class="text-verified size-4" /> {pieceLabel(x.a.label)} side {x.c.sideA + 1} fits {pieceLabel(x.b.label)} side {x.c.sideB + 1}</li>
						{/each}
					</ul>
				</div>
			{/if}
		</aside>
	</main>
{/if}
