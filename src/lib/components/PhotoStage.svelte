<!--
	The photo of the table with an SVG layer in image-pixel coordinates.
	Supports wheel / pinch zoom and drag-to-pan; tools receive image coordinates.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Maximize, Minus, Plus } from '@lucide/svelte';

	export interface StagePointer {
		kind: 'down' | 'move' | 'up' | 'tap';
		x: number;
		y: number;
		event: PointerEvent;
	}

	let {
		src,
		width,
		height,
		alt = 'Photo of the puzzle pieces on the table',
		children,
		under,
		onpointer,
		pan = true,
		cursor = 'default',
		dim = false,
		class: klass = '',
		controls = true,
		loading = false,
		scale = $bindable(1)
	}: {
		src?: string;
		width: number;
		height: number;
		alt?: string;
		children?: Snippet;
		under?: Snippet;
		onpointer?: (p: StagePointer) => void;
		pan?: boolean;
		cursor?: string;
		dim?: boolean;
		class?: string;
		controls?: boolean;
		loading?: boolean;
		/** screen pixels per image pixel (read-only binding) */
		scale?: number;
	} = $props();

	let box = $state<HTMLDivElement>();
	let svg = $state<SVGSVGElement>();
	let boxW = $state(0);
	let boxH = $state(0);
	let zoom = $state(1);
	let tx = $state(0);
	let ty = $state(0);
	let imgLoaded = $state(false);

	const fit = $derived(boxW && boxH ? Math.min(boxW / width, boxH / height) : 0);
	const baseW = $derived(width * fit);
	const baseH = $derived(height * fit);
	$effect(() => {
		scale = zoom * fit || 1;
	});

	function clampPan() {
		const w = baseW * zoom;
		const h = baseH * zoom;
		tx = w <= boxW ? (boxW - w) / 2 : Math.min(0, Math.max(boxW - w, tx));
		ty = h <= boxH ? (boxH - h) / 2 : Math.min(0, Math.max(boxH - h, ty));
	}

	$effect(() => {
		// refit when the container or image changes
		void boxW;
		void boxH;
		void width;
		void height;
		clampPan();
	});

	function zoomAt(factor: number, cx: number, cy: number) {
		const next = Math.min(6, Math.max(1, zoom * factor));
		const k = next / zoom;
		tx = cx - (cx - tx) * k;
		ty = cy - (cy - ty) * k;
		zoom = next;
		clampPan();
	}

	export function resetView() {
		zoom = 1;
		clampPan();
	}

	/** Zooms so an image-space rectangle fills most of the view. */
	export function focusRect(r: { x: number; y: number; w: number; h: number }, maxZoom = 3) {
		const z = Math.min(maxZoom, Math.max(1, Math.min(boxW / (r.w * fit), boxH / (r.h * fit)) * 0.6));
		zoom = z;
		tx = boxW / 2 - (r.x + r.w / 2) * fit * z;
		ty = boxH / 2 - (r.y + r.h / 2) * fit * z;
		clampPan();
	}

	function toImage(e: PointerEvent | MouseEvent) {
		const ctm = svg?.getScreenCTM();
		if (!ctm) return { x: 0, y: 0 };
		const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
		return { x: Math.max(0, Math.min(width - 1, p.x)), y: Math.max(0, Math.min(height - 1, p.y)) };
	}

	const pointers = new Map<number, { x: number; y: number }>();
	let dragStart: { x: number; y: number; tx: number; ty: number } | null = null;
	let moved = false;
	let pinch: { d: number; zoom: number } | null = null;

	function rel(e: PointerEvent) {
		const r = box!.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function onDown(e: PointerEvent) {
		if (e.button !== 0 && e.pointerType === 'mouse') return;
		if ((e.target as Element).closest('button, a, input')) return;
		box!.setPointerCapture(e.pointerId);
		pointers.set(e.pointerId, rel(e));
		moved = false;
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom };
			dragStart = null;
			return;
		}
		const p = rel(e);
		dragStart = { x: p.x, y: p.y, tx, ty };
		onpointer?.({ kind: 'down', ...toImage(e), event: e });
	}

	function onMove(e: PointerEvent) {
		if (!pointers.has(e.pointerId)) {
			onpointer?.({ kind: 'move', ...toImage(e), event: e });
			return;
		}
		pointers.set(e.pointerId, rel(e));
		if (pinch && pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			const d = Math.hypot(a.x - b.x, a.y - b.y);
			zoomAt((pinch.zoom * d) / pinch.d / zoom, (a.x + b.x) / 2, (a.y + b.y) / 2);
			moved = true;
			return;
		}
		const p = rel(e);
		if (dragStart && Math.hypot(p.x - dragStart.x, p.y - dragStart.y) > 5) moved = true;
		if (pan && dragStart && zoom > 1.01 && moved) {
			tx = dragStart.tx + (p.x - dragStart.x);
			ty = dragStart.ty + (p.y - dragStart.y);
			clampPan();
			return;
		}
		onpointer?.({ kind: 'move', ...toImage(e), event: e });
	}

	function onUp(e: PointerEvent) {
		const wasPinch = pinch !== null;
		pointers.delete(e.pointerId);
		if (pointers.size < 2) pinch = null;
		if (wasPinch) return;
		const img = toImage(e);
		onpointer?.({ kind: 'up', ...img, event: e });
		if (!moved) onpointer?.({ kind: 'tap', ...img, event: e });
		dragStart = null;
	}

	$effect(() => {
		// non-passive so the page does not scroll while zooming the photo
		const el = box;
		if (!el) return;
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	});

	function onWheel(e: WheelEvent) {
		// trackpad pinch arrives as ctrl+wheel and needs a stronger factor
		e.preventDefault();
		const r = box!.getBoundingClientRect();
		zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
	}
</script>

<div
	bind:this={box}
	bind:clientWidth={boxW}
	bind:clientHeight={boxH}
	class="relative overflow-hidden rounded-[16px] bg-[#2b3a33] select-none max-lg:aspect-(--ar) max-lg:h-auto {klass}"
	style="touch-action: none; cursor: {cursor}; --ar: {width} / {height}"
	onpointerdown={onDown}
	onpointermove={onMove}
	onpointerup={onUp}
	onpointercancel={onUp}
	role="application"
	aria-label={alt}
>
	{#if fit}
		<div
			class="absolute top-0 left-0 origin-top-left will-change-transform"
			style="width:{baseW}px;height:{baseH}px;transform:translate({tx}px,{ty}px) scale({zoom})"
		>
			{#if src}
				<img
					{src}
					{alt}
					draggable="false"
					class="absolute inset-0 size-full transition-[opacity,filter] duration-300"
					style="opacity:{imgLoaded ? 1 : 0}; filter:{dim ? 'saturate(0.55) brightness(0.82)' : 'none'}"
					onload={() => (imgLoaded = true)}
				/>
			{/if}
			{@render under?.()}
			<svg
				bind:this={svg}
				viewBox="0 0 {width} {height}"
				class="absolute inset-0 size-full overflow-visible"
				style="--z:{zoom * fit}"
				aria-hidden="true"
			>
				{@render children?.()}
			</svg>
		</div>
	{/if}
	{#if loading || (src && !imgLoaded)}
		<div class="absolute inset-0 grid place-items-center">
			<div class="h-2 w-28 overflow-hidden rounded-full bg-white/15">
				<div class="h-full w-1/2 rounded-full bg-white/50" style="animation: breathe 1.4s ease-in-out infinite"></div>
			</div>
		</div>
	{/if}
	{#if controls && fit}
		<div class="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-[10px] border border-white/15 bg-[#1f2a25]/80 text-white backdrop-blur-sm">
			<button class="grid size-10 place-items-center hover:bg-white/10" aria-label="Zoom in" onclick={() => zoomAt(1.4, boxW / 2, boxH / 2)}
				><Plus class="size-4" /></button
			>
			<button class="grid size-10 place-items-center hover:bg-white/10" aria-label="Zoom out" onclick={() => zoomAt(1 / 1.4, boxW / 2, boxH / 2)}
				><Minus class="size-4" /></button
			>
			<button class="grid size-10 place-items-center hover:bg-white/10" aria-label="Fit photo" onclick={resetView}
				><Maximize class="size-4" /></button
			>
		</div>
	{/if}
</div>
