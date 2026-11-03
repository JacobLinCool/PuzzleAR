<!--
	Piece outlines and number tags drawn in image coordinates inside PhotoStage's SVG.
	Tags and strokes keep a constant on-screen size at any zoom (via --z).
-->
<script lang="ts">
	import { svgPath } from '$lib/client/render';
	import type { Pt } from '$lib/vision/types';

	export type PieceTone = 'default' | 'selected' | 'dim' | 'review' | 'placed' | 'find' | 'neighbour' | 'new';

	export interface OverlayItem {
		id: string;
		label: number;
		outline: Pt[];
		tone: PieceTone;
		centroid: Pt;
	}

	let { items, labels = true, fills = true }: { items: OverlayItem[]; labels?: boolean; fills?: boolean } = $props();

	const style: Record<PieceTone, { fill: string; fo: number; stroke: string; dash?: string; sw: number }> = {
		default: { fill: '#2fb39f', fo: 0.15, stroke: '#7fe0d0', sw: 2 },
		selected: { fill: '#2fb39f', fo: 0.65, stroke: '#ffffff', sw: 3 },
		neighbour: { fill: '#2fb39f', fo: 0.35, stroke: '#bff3ea', sw: 2.5 },
		dim: { fill: '#2fb39f', fo: 0.05, stroke: '#7fe0d0', sw: 1 },
		review: { fill: '#e0a145', fo: 0.22, stroke: '#f3c27a', dash: '7 5', sw: 2.5 },
		placed: { fill: '#000000', fo: 0.35, stroke: '#9fb0a8', dash: '3 4', sw: 1.5 },
		find: { fill: '#ffffff', fo: 0.12, stroke: '#ffffff', sw: 3 },
		new: { fill: '#2fb39f', fo: 0.3, stroke: '#ffffff', sw: 2.5 }
	};
</script>

{#each items as it (it.id)}
	{@const s = style[it.tone]}
	<g style="animation: fade-in 200ms ease-out both">
		<path
			d={svgPath(it.outline)}
			fill={fills ? s.fill : 'none'}
			fill-opacity={s.fo}
			stroke={s.stroke}
			stroke-width={s.sw}
			stroke-dasharray={s.dash}
			stroke-linejoin="round"
			vector-effect="non-scaling-stroke"
			style={it.tone === 'find' ? 'animation: find-pulse 1.6s ease-in-out infinite' : ''}
		/>
	</g>
{/each}
{#if labels}
	{#each items as it (it.id)}
		{#if it.tone !== 'placed'}
			<g style="transform: translate({it.centroid.x}px, {it.centroid.y}px) scale(calc(var(--tag, 1) / var(--z)))">
				<rect
					x="-17"
					y="-12"
					width="34"
					height="24"
					rx="6"
					fill={it.tone === 'selected' || it.tone === 'find' ? '#ffffff' : it.tone === 'review' ? '#8a5713' : '#24312d'}
					fill-opacity={it.tone === 'dim' ? 0.55 : 0.92}
				/>
				<text
					x="0"
					y="4.5"
					text-anchor="middle"
					font-size="13"
					font-weight="650"
					font-family="Inter Variable, Inter, sans-serif"
					style="font-variant-numeric: tabular-nums"
					fill={it.tone === 'selected' || it.tone === 'find' ? '#24312d' : '#ffffff'}
					>{String(it.label).padStart(2, '0')}</text
				>
			</g>
		{/if}
	{/each}
{/if}
