<!--
	The proposed board, composed from real piece textures. Cells are focusable
	buttons laid over the canvas so the board works with keyboard and screen readers.
-->
<script lang="ts">
	import { drawPieceInCell, type BoardItem } from '$lib/client/render';

	export interface BoardEdgeMark {
		row: number;
		col: number;
		/** 1 = edge to the right neighbour, 2 = edge to the one below */
		dir: 1 | 2;
		confidence: 'strong' | 'check' | 'confirmed';
	}

	let {
		rows,
		cols,
		items,
		faded = new Set<string>(),
		selected,
		target,
		edges = [],
		showEdges = false,
		oncell,
		cellLabel,
		emptyLabel = 'Empty cell',
		class: klass = '',
		kraft = false
	}: {
		rows: number;
		cols: number;
		items: BoardItem[];
		/** piece ids drawn as faint ghosts (not yet placed) */
		faded?: Set<string>;
		selected?: { row: number; col: number };
		target?: { row: number; col: number };
		edges?: BoardEdgeMark[];
		showEdges?: boolean;
		oncell?: (row: number, col: number) => void;
		cellLabel?: (row: number, col: number) => string;
		emptyLabel?: string;
		class?: string;
		kraft?: boolean;
	} = $props();

	let wrap = $state<HTMLDivElement>();
	let canvas = $state<HTMLCanvasElement>();
	let w = $state(0);

	const padRatio = 0.3;
	const cell = $derived(w ? w / (cols + padRatio * 2) : 0);
	const pad = $derived(cell * padRatio);
	const h = $derived(cell * (rows + padRatio * 2));

	$effect(() => {
		if (!canvas || !cell) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		// cell grid, like a pencilled frame on the board
		ctx.save();
		ctx.strokeStyle = kraft ? 'rgba(90,70,40,0.35)' : 'rgba(36,49,45,0.14)';
		ctx.setLineDash([4, 5]);
		ctx.lineWidth = 1;
		for (let r = 0; r <= rows; r++) {
			ctx.beginPath();
			ctx.moveTo(pad, pad + r * cell);
			ctx.lineTo(pad + cols * cell, pad + r * cell);
			ctx.stroke();
		}
		for (let c = 0; c <= cols; c++) {
			ctx.beginPath();
			ctx.moveTo(pad + c * cell, pad);
			ctx.lineTo(pad + c * cell, pad + rows * cell);
			ctx.stroke();
		}
		ctx.restore();
		ctx.imageSmoothingQuality = 'high';
		ctx.shadowColor = 'rgba(36,49,45,0.28)';
		ctx.shadowBlur = 4;
		ctx.shadowOffsetY = 1.5;
		for (const it of items) {
			const ghost = faded.has(it.placement.pieceId);
			if (ghost) continue;
			drawPieceInCell(ctx, it, cell * dpr, { x: pad * dpr, y: pad * dpr }, 1);
		}
		ctx.shadowColor = 'transparent';
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		for (const it of items) {
			if (!faded.has(it.placement.pieceId)) continue;
			ctx.save();
			drawPieceInCell(ctx, it, cell * dpr, { x: pad * dpr, y: pad * dpr }, 0.16);
			ctx.restore();
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (showEdges) {
			for (const e of edges) {
				const x = pad + (e.col + (e.dir === 1 ? 1 : 0.5)) * cell;
				const y = pad + (e.row + (e.dir === 2 ? 1 : 0.5)) * cell;
				const len = cell * 0.36;
				ctx.save();
				ctx.lineCap = 'round';
				ctx.lineWidth = 4;
				ctx.strokeStyle = 'rgba(255,255,255,0.9)';
				const seg = () => {
					ctx.beginPath();
					if (e.dir === 1) {
						ctx.moveTo(x, y - len / 2);
						ctx.lineTo(x, y + len / 2);
					} else {
						ctx.moveTo(x - len / 2, y);
						ctx.lineTo(x + len / 2, y);
					}
					ctx.stroke();
				};
				seg();
				ctx.lineWidth = 2.5;
				ctx.strokeStyle = e.confidence === 'strong' ? '#167A6B' : e.confidence === 'confirmed' ? '#247B56' : '#B97720';
				if (e.confidence === 'check') ctx.setLineDash([3, 4]);
				seg();
				ctx.restore();
			}
		}
	});
</script>

<div bind:this={wrap} bind:clientWidth={w} class="relative w-full {klass}" style="height:{h}px">
	{#if kraft && cell}
		<div
			class="absolute rounded-[6px] bg-kraft/70"
			style="left:{pad - cell * 0.12}px;top:{pad - cell * 0.12}px;width:{cols * cell + cell * 0.24}px;height:{rows * cell + cell * 0.24}px"
		></div>
	{/if}
	<canvas bind:this={canvas} class="absolute inset-0 size-full"></canvas>
	{#if cell}
		<div class="absolute grid" style="left:{pad}px;top:{pad}px;width:{cols * cell}px;height:{rows * cell}px;grid-template-columns:repeat({cols},1fr);grid-template-rows:repeat({rows},1fr)" role="grid" aria-label="Puzzle board, {rows} rows by {cols} columns">
			{#each Array(rows) as _, r (r)}
				{#each Array(cols) as __, c (c)}
					{@const isSel = selected?.row === r && selected?.col === c}
					{@const isTarget = target?.row === r && target?.col === c}
					<button
						class="relative rounded-[4px] outline-offset-[-2px] transition-[box-shadow,background-color] duration-150 {oncell ? 'cursor-pointer hover:bg-white/15' : 'cursor-default'}"
						style={isSel ? 'box-shadow: inset 0 0 0 3px #167A6B, 0 0 0 2px #fff' : isTarget ? 'box-shadow: inset 0 0 0 3px #fff, 0 0 0 2px #167A6B' : ''}
						aria-label={cellLabel?.(r, c) ?? emptyLabel}
						aria-pressed={isSel}
						tabindex={oncell ? 0 : -1}
						onclick={() => oncell?.(r, c)}
					>
						{#if isTarget}
							<span class="absolute inset-[18%] rounded-[6px] border-2 border-dashed border-teal bg-teal/10" style="animation: breathe 1.6s ease-in-out infinite"></span>
						{/if}
					</button>
				{/each}
			{/each}
		</div>
	{/if}
</div>
