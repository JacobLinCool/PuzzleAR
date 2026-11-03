<!--
	Landing-page preview: the sample photo with real SAM 3.1 outlines. Tapping a
	piece lights up the neighbours the solver proposes and where it goes.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { sampleUrl } from '$lib/client/sample';

	interface PreviewPiece {
		index: number;
		label: number;
		outline: [number, number][];
		centroid: [number, number];
		cell: [number, number];
		neighbours: { piece: number; relation: string; confidence: 'strong' | 'check' | 'confirmed' }[];
	}
	interface Preview {
		width: number;
		height: number;
		rows: number;
		cols: number;
		pieces: PreviewPiece[];
	}

	let data = $state<Preview | null>(null);
	let active = $state<number | null>(null);
	let touched = $state(false);
	let timer: ReturnType<typeof setInterval> | undefined;

	const tag = (n: number) => `#${String(n).padStart(2, '0')}`;
	const path = (o: [number, number][]) => o.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('') + 'Z';
	const current = $derived(data && active !== null ? data.pieces[active] : null);
	const neighbourSet = $derived(new Set(current?.neighbours.map((n) => n.piece) ?? []));

	onMount(() => {
		fetch(sampleUrl('preview.json'))
			.then((r) => r.json() as Promise<Preview>)
			.then((d: Preview) => {
				data = d;
				// start on a piece with several neighbours so the idea lands immediately
				const order = [...d.pieces].sort((a, b) => b.neighbours.length - a.neighbours.length);
				active = order[0].index;
				if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
					let k = 0;
					timer = setInterval(() => {
						if (touched) return clearInterval(timer);
						k = (k + 1) % order.length;
						active = order[k].index;
					}, 2600);
				}
			})
			.catch(() => {});
		return () => clearInterval(timer);
	});

	function pick(i: number) {
		touched = true;
		active = i;
	}
</script>

<figure class="relative">
	<div class="relative overflow-hidden rounded-[20px] bg-[#2f4a3e] shadow-[0_30px_60px_-30px_rgb(36_49_45/0.55),0_2px_6px_rgb(36_49_45/0.12)] ring-1 ring-black/5">
		<img
			src={sampleUrl('preview.webp')}
			alt="Sixteen jigsaw pieces scattered on a green felt mat"
			width="760"
			height="878"
			class="block h-auto w-full"
			fetchpriority="high"
		/>
		{#if data}
			<svg viewBox="0 0 {data.width} {data.height}" class="absolute inset-0 size-full" role="group" aria-label="Pieces found in the sample photo">
				{#if current}
					{#each current.neighbours as n (n.piece)}
						{@const nb = data.pieces[n.piece]}
						<line
							x1={current.centroid[0]}
							y1={current.centroid[1]}
							x2={nb.centroid[0]}
							y2={nb.centroid[1]}
							stroke={n.confidence === 'strong' ? '#9ff0e2' : '#f3c27a'}
							stroke-width="2"
							stroke-dasharray={n.confidence === 'strong' ? '' : '5 5'}
							stroke-linecap="round"
							style="animation: fade-in 260ms ease-out both"
						/>
					{/each}
				{/if}
				{#each data.pieces as p (p.index)}
					{@const isActive = p.index === active}
					{@const isNb = neighbourSet.has(p.index)}
					<path
						d={path(p.outline)}
						fill="#2fb39f"
						fill-opacity={isActive ? 0.62 : isNb ? 0.32 : 0.1}
						stroke={isActive ? '#ffffff' : isNb ? '#bff3ea' : '#7fe0d0'}
						stroke-width={isActive ? 2.5 : 1.5}
						stroke-linejoin="round"
						class="cursor-pointer transition-[fill-opacity,stroke] duration-200 focus:outline-none"
						role="button"
						tabindex="0"
						aria-label="Piece {tag(p.label)}"
						onclick={() => pick(p.index)}
						onmouseenter={() => pick(p.index)}
						onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && pick(p.index)}
						onfocus={() => pick(p.index)}
					/>
				{/each}
				{#each data.pieces as p (p.index)}
					{@const isActive = p.index === active}
					<g transform="translate({p.centroid[0]} {p.centroid[1]})" pointer-events="none">
						<rect x="-15" y="-10.5" width="30" height="21" rx="5" fill={isActive ? '#fff' : '#24312d'} fill-opacity="0.92" />
						<text y="4" text-anchor="middle" font-size="11.5" font-weight="650" fill={isActive ? '#24312d' : '#fff'} style="font-variant-numeric: tabular-nums">{String(p.label).padStart(2, '0')}</text>
					</g>
				{/each}
			</svg>
		{/if}
	</div>

	<!-- what the solver says about the active piece -->
	<figcaption class="card absolute -bottom-6 left-4 right-4 flex items-center gap-4 px-4 py-3 shadow-[var(--shadow-lift)] sm:left-auto sm:-right-4 sm:w-[300px] lg:-right-8">
		{#if data && current}
			<div class="grid shrink-0 gap-[3px]" style="grid-template-columns: repeat({data.cols}, 12px)" aria-hidden="true">
				{#each Array(data.rows * data.cols) as _, k (k)}
					{@const r = Math.floor(k / data.cols)}
					{@const c = k % data.cols}
					{@const here = current.cell[0] === r && current.cell[1] === c}
					{@const nb = current.neighbours.some((n) => data!.pieces[n.piece].cell[0] === r && data!.pieces[n.piece].cell[1] === c)}
					<span class="size-3 rounded-[3px] {here ? 'bg-teal' : nb ? 'bg-teal/35' : 'bg-line'}"></span>
				{/each}
			</div>
			<div class="min-w-0 text-[0.8125rem] leading-[1.15rem]">
				<p class="font-semibold">
					Piece {tag(current.label)} → row {current.cell[0] + 1}, column {current.cell[1] + 1}
				</p>
				<p class="text-muted">
					Fits {current.neighbours.map((n) => tag(data!.pieces[n.piece].label)).join(', ')}
					· {current.neighbours.filter((n) => n.confidence === 'strong').length} strong, {current.neighbours.filter((n) => n.confidence !== 'strong').length} to check
				</p>
			</div>
		{:else}
			<div class="bg-line h-10 w-full rounded" style="animation: breathe 1.4s ease-in-out infinite"></div>
		{/if}
	</figcaption>
</figure>
