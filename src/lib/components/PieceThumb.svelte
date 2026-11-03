<!-- A real-texture cutout of one piece, optionally turned to its board orientation. -->
<script lang="ts">
	import type { PieceGeometry } from '$lib/vision/types';
	import type { MaskRecord } from '$lib/shared/doc';
	import { pieceToGrid } from '$lib/vision/homography';

	let {
		cutout,
		mask,
		geom,
		rot,
		size = 96,
		showSides = false,
		sideTypes,
		class: klass = ''
	}: {
		cutout?: HTMLCanvasElement;
		mask?: MaskRecord;
		geom?: PieceGeometry;
		/** When set, draw the piece upright as it sits on the board. */
		rot?: number;
		size?: number;
		/** Overlay the four detected sides, coloured by type and numbered. */
		showSides?: boolean;
		sideTypes?: Partial<Record<number, string>>;
		class?: string;
	} = $props();

	const sideColor: Record<string, string> = { flat: '#6A7770', tab: '#167A6B', socket: '#B97720', unknown: '#B74444' };

	let canvas = $state<HTMLCanvasElement>();

	$effect(() => {
		if (!canvas || !cutout || !mask) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = size * dpr;
		canvas.height = size * dpr;
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.imageSmoothingQuality = 'high';
		if (geom && rot !== undefined) {
			// place the base square in the middle 62% of the thumb
			const cell = size * dpr * 0.62;
			const off = (size * dpr - cell) / 2;
			const s = pieceToGrid(geom.corners, 0, 0, rot);
			ctx.setTransform(s.a * cell, s.b * cell, -s.b * cell, s.a * cell, s.tx * cell + off, s.ty * cell + off);
			ctx.drawImage(cutout, mask.left, mask.top);
		} else {
			const pad = showSides ? 0.74 : 0.92;
			const k = (size * dpr * pad) / Math.max(mask.width, mask.height);
			const w = mask.width * k;
			const h = mask.height * k;
			const ox = (size * dpr - w) / 2;
			const oy = (size * dpr - h) / 2;
			ctx.drawImage(cutout, ox, oy, w, h);
			if (showSides && geom) {
				const map = (p: { x: number; y: number }) => ({ x: ox + (p.x - mask.left) * k, y: oy + (p.y - mask.top) * k });
				const c = map(geom.centroid);
				ctx.lineCap = 'round';
				ctx.lineJoin = 'round';
				geom.sides.forEach((s, i) => {
					const color = sideColor[sideTypes?.[i] ?? s.type];
					ctx.strokeStyle = 'rgba(255,255,255,0.9)';
					ctx.lineWidth = 5 * dpr;
					ctx.beginPath();
					s.framePts.forEach((p, j) => {
						const q = map(p);
						if (j) ctx.lineTo(q.x, q.y);
						else ctx.moveTo(q.x, q.y);
					});
					ctx.stroke();
					ctx.strokeStyle = color;
					ctx.lineWidth = 2.6 * dpr;
					ctx.stroke();
					// number badge pushed outward from the piece centre
					const m = map(s.framePts[Math.floor(s.framePts.length / 2)]);
					const dx = m.x - c.x;
					const dy = m.y - c.y;
					const len = Math.hypot(dx, dy) || 1;
					const bx = Math.min(size * dpr - 10 * dpr, Math.max(10 * dpr, m.x + (dx / len) * 9 * dpr));
					const by = Math.min(size * dpr - 10 * dpr, Math.max(10 * dpr, m.y + (dy / len) * 9 * dpr));
					ctx.fillStyle = color;
					ctx.beginPath();
					ctx.arc(bx, by, 8.5 * dpr, 0, Math.PI * 2);
					ctx.fill();
					ctx.fillStyle = '#fff';
					ctx.font = `700 ${10.5 * dpr}px Inter Variable, Inter, sans-serif`;
					ctx.textAlign = 'center';
					ctx.textBaseline = 'middle';
					ctx.fillText(String(i + 1), bx, by + 0.5 * dpr);
				});
			}
		}
	});
</script>

<canvas
	bind:this={canvas}
	class="drop-shadow-[0_2px_3px_rgb(36_49_45/0.25)] {klass}"
	style="width:{size}px;height:{size}px"
	aria-hidden="true"
></canvas>
