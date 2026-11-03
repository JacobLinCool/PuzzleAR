import type { MaskROI, Pt } from './types';

/** Keeps the largest 4-connected component and fills interior holes. */
export function cleanMask(mask: MaskROI): { mask: MaskROI; components: number } {
	const { width: w, height: h, data } = mask;
	const label = new Int32Array(w * h);
	const stack: number[] = [];
	let best = 0;
	let bestSize = 0;
	let components = 0;
	let next = 1;
	for (let i = 0; i < w * h; i++) {
		if (!data[i] || label[i]) continue;
		const id = next++;
		let size = 0;
		label[i] = id;
		stack.push(i);
		while (stack.length) {
			const k = stack.pop()!;
			size++;
			const x = k % w;
			const y = (k - x) / w;
			if (x > 0 && data[k - 1] && !label[k - 1]) (label[k - 1] = id), stack.push(k - 1);
			if (x < w - 1 && data[k + 1] && !label[k + 1]) (label[k + 1] = id), stack.push(k + 1);
			if (y > 0 && data[k - w] && !label[k - w]) (label[k - w] = id), stack.push(k - w);
			if (y < h - 1 && data[k + w] && !label[k + w]) (label[k + w] = id), stack.push(k + w);
		}
		if (size > 30) components++;
		if (size > bestSize) {
			bestSize = size;
			best = id;
		}
	}
	const out = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) out[i] = label[i] === best ? 1 : 0;

	// Fill holes: flood the background from the border; anything unreached is a hole.
	const outside = new Uint8Array(w * h);
	const push = (k: number) => {
		if (!out[k] && !outside[k]) {
			outside[k] = 1;
			stack.push(k);
		}
	};
	for (let x = 0; x < w; x++) push(x), push((h - 1) * w + x);
	for (let y = 0; y < h; y++) push(y * w), push(y * w + w - 1);
	while (stack.length) {
		const k = stack.pop()!;
		const x = k % w;
		const y = (k - x) / w;
		if (x > 0) push(k - 1);
		if (x < w - 1) push(k + 1);
		if (y > 0) push(k - w);
		if (y < h - 1) push(k + w);
	}
	for (let i = 0; i < w * h; i++) if (!outside[i]) out[i] = 1;
	return { mask: { ...mask, data: out }, components: Math.max(components, 1) };
}

export function maskArea(mask: MaskROI): number {
	let a = 0;
	for (let i = 0; i < mask.data.length; i++) a += mask.data[i];
	return a;
}

export function maskAt(mask: MaskROI, x: number, y: number): boolean {
	const lx = Math.floor(x) - mask.left;
	const ly = Math.floor(y) - mask.top;
	if (lx < 0 || ly < 0 || lx >= mask.width || ly >= mask.height) return false;
	return mask.data[ly * mask.width + lx] === 1;
}

/** Intersection over union of two full-frame masks. */
export function maskIoU(a: MaskROI, b: MaskROI): number {
	const x0 = Math.max(a.left, b.left);
	const y0 = Math.max(a.top, b.top);
	const x1 = Math.min(a.left + a.width, b.left + b.width);
	const y1 = Math.min(a.top + a.height, b.top + b.height);
	let inter = 0;
	for (let y = y0; y < y1; y++) {
		for (let x = x0; x < x1; x++) {
			if (
				a.data[(y - a.top) * a.width + (x - a.left)] &&
				b.data[(y - b.top) * b.width + (x - b.left)]
			)
				inter++;
		}
	}
	if (!inter) return 0;
	return inter / (maskArea(a) + maskArea(b) - inter);
}

/** Rasterises a polygon (full-frame coords) into a tight ROI mask. */
export function polygonToMask(poly: Pt[]): MaskROI {
	let x0 = Infinity,
		y0 = Infinity,
		x1 = -Infinity,
		y1 = -Infinity;
	for (const p of poly) {
		x0 = Math.min(x0, p.x);
		y0 = Math.min(y0, p.y);
		x1 = Math.max(x1, p.x);
		y1 = Math.max(y1, p.y);
	}
	const left = Math.floor(x0);
	const top = Math.floor(y0);
	const width = Math.ceil(x1) - left + 1;
	const height = Math.ceil(y1) - top + 1;
	const data = new Uint8Array(width * height);
	const xs: number[] = [];
	for (let row = 0; row < height; row++) {
		const y = top + row + 0.5;
		xs.length = 0;
		for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
			const a = poly[i];
			const b = poly[j];
			if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
		}
		xs.sort((m, n) => m - n);
		for (let k = 0; k + 1 < xs.length; k += 2) {
			const from = Math.max(0, Math.ceil(xs[k] - 0.5 - left));
			const to = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5 - left));
			for (let x = from; x <= to; x++) data[row * width + x] = 1;
		}
	}
	return { left, top, width, height, data };
}

/** COCO-style uncompressed RLE (row-major, starting with a zero run) for storage. */
export function encodeRLE(mask: MaskROI): number[] {
	const runs: number[] = [];
	let cur = 0;
	let run = 0;
	for (let i = 0; i < mask.data.length; i++) {
		if (mask.data[i] !== cur) {
			runs.push(run);
			run = 0;
			cur = mask.data[i];
		}
		run++;
	}
	runs.push(run);
	return runs;
}

export function decodeRLE(
	runs: number[],
	box: { left: number; top: number; width: number; height: number }
): MaskROI {
	const data = new Uint8Array(box.width * box.height);
	let pos = 0;
	let v = 0;
	for (const r of runs) {
		if (v) data.fill(1, pos, pos + r);
		pos += r;
		v ^= 1;
	}
	return { ...box, data };
}
