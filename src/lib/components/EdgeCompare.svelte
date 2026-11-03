<!--
	Side-by-side evidence for one proposed edge: the two cut shapes overlaid
	(one mirrored onto the other) and the colors sampled just inside each cut.
-->
<script lang="ts">
	import { labToRgb } from '$lib/vision/color';
	import type { SideGeom } from '$lib/vision/types';

	let {
		a,
		b,
		scores,
		labelA,
		labelB
	}: {
		a: SideGeom;
		b: SideGeom;
		scores?: { shape: number; color: number; length: number };
		labelA: string;
		labelB: string;
	} = $props();

	const W = 240;
	const H = 92;
	const k = $derived((W - 24) / Math.max(a.length, b.length));
	const lineA = $derived(a.pts.map((p) => `${12 + p.x * k},${H / 2 - p.y * k}`).join(' '));
	// B seen from A's side: reversed and mirrored across the chord
	const lineB = $derived(
		[...b.pts].reverse().map((p) => `${12 + (b.length - p.x) * k},${H / 2 + p.y * k}`).join(' ')
	);
	function strip(s: SideGeom, reverse: boolean) {
		const out: string[] = [];
		const n = 32;
		for (let i = 0; i < n; i++) {
			const j = Math.floor(((reverse ? n - 1 - i : i) + 0.5) * (s.lab.length / 3 / n));
			const [r, g, bl] = labToRgb(s.lab[j * 3], s.lab[j * 3 + 1], s.lab[j * 3 + 2]);
			out.push(`rgb(${r} ${g} ${bl})`);
		}
		return out;
	}
	const stripA = $derived(strip(a, false));
	const stripB = $derived(strip(b, true));
	const level = (v: number | undefined) => (v === undefined ? '—' : v < 0.55 ? 'Close' : v < 0.95 ? 'Fair' : 'Loose');
	const tone = (v: number | undefined) => (v === undefined ? 'text-muted' : v < 0.55 ? 'text-teal' : v < 0.95 ? 'text-ink' : 'text-amber-ink');
</script>

<div class="grid gap-2">
	<svg viewBox="0 0 {W} {H}" class="bg-ground-deep w-full rounded-[10px]" role="img" aria-label="Edge shapes of {labelA} and {labelB} overlaid">
		<line x1="12" x2={W - 12} y1={H / 2} y2={H / 2} stroke="#24312d" stroke-opacity="0.12" stroke-dasharray="2 4" />
		<polyline points={lineA} fill="none" stroke="#167A6B" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
		<polyline points={lineB} fill="none" stroke="#24312d" stroke-width="1.75" stroke-dasharray="4 3" stroke-linejoin="round" />
		<text x="12" y="14" font-size="10" fill="#167A6B" font-weight="600">{labelA}</text>
		<text x={W - 12} y="14" font-size="10" fill="#24312d" text-anchor="end" font-weight="600">{labelB} (mirrored)</text>
	</svg>
	<div class="grid gap-1" aria-hidden="true">
		<div class="flex h-2.5 overflow-hidden rounded-t-[4px]">{#each stripA as c, i (i)}<span class="flex-1" style="background:{c}"></span>{/each}</div>
		<div class="flex h-2.5 overflow-hidden rounded-b-[4px]">{#each stripB as c, i (i)}<span class="flex-1" style="background:{c}"></span>{/each}</div>
	</div>
	<dl class="text-[0.8125rem] grid grid-cols-3 gap-2">
		<div><dt class="text-muted">Shape</dt><dd class="font-semibold {tone(scores?.shape)}">{level(scores?.shape)}</dd></div>
		<div><dt class="text-muted">Color seam</dt><dd class="font-semibold {tone(scores?.color)}">{level(scores?.color)}</dd></div>
		<div><dt class="text-muted">Length</dt><dd class="font-semibold {tone(scores?.length)}">{level(scores?.length)}</dd></div>
	</dl>
</div>
