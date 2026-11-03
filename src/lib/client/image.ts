import type { RGBAImage } from '$lib/vision/types';

export const MAX_EDGE = 2048;

export interface LoadedPhoto {
	bitmap: ImageBitmap;
	pixels: RGBAImage;
	width: number;
	height: number;
}

export async function bitmapToPixels(bitmap: ImageBitmap): Promise<RGBAImage> {
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	ctx.drawImage(bitmap, 0, 0);
	const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
	return { width: data.width, height: data.height, data: data.data };
}

export async function loadPhoto(url: string): Promise<LoadedPhoto> {
	const res = await fetch(url, { credentials: 'same-origin' });
	if (!res.ok) throw new Error(res.status === 404 ? 'PHOTO_GONE' : 'PHOTO_LOAD_FAILED');
	const bitmap = await createImageBitmap(await res.blob());
	return { bitmap, pixels: await bitmapToPixels(bitmap), width: bitmap.width, height: bitmap.height };
}

/**
 * Applies EXIF orientation, scales the longest edge to <= 2048 px and re-encodes
 * as JPEG, which also drops EXIF/GPS metadata before anything leaves the device.
 */
export async function normalizePhoto(source: Blob | ImageBitmap | HTMLVideoElement): Promise<{ blob: Blob; bitmap: ImageBitmap; scale: number; originalWidth: number; originalHeight: number }> {
	let bitmap: ImageBitmap;
	if (source instanceof Blob) bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
	else if (source instanceof HTMLVideoElement) bitmap = await createImageBitmap(source);
	else bitmap = source;
	const ow = bitmap.width;
	const oh = bitmap.height;
	const scale = Math.min(1, MAX_EDGE / Math.max(ow, oh));
	const w = Math.round(ow * scale);
	const h = Math.round(oh * scale);
	const canvas = new OffscreenCanvas(w, h);
	const ctx = canvas.getContext('2d')!;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(bitmap, 0, 0, w, h);
	const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
	const out = await createImageBitmap(blob);
	return { blob, bitmap: out, scale, originalWidth: ow, originalHeight: oh };
}

export interface QualityReport {
	width: number;
	height: number;
	blur: number;
	dark: number;
	bright: number;
	warnings: { id: string; message: string }[];
}

/** Cheap pre-checks: size, Laplacian-variance sharpness and exposure clipping. */
export async function checkQuality(bitmap: ImageBitmap): Promise<QualityReport> {
	const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
	const w = Math.round(bitmap.width * scale);
	const h = Math.round(bitmap.height * scale);
	const canvas = new OffscreenCanvas(w, h);
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	ctx.drawImage(bitmap, 0, 0, w, h);
	const { data } = ctx.getImageData(0, 0, w, h);
	const g = new Float32Array(w * h);
	let dark = 0,
		bright = 0;
	for (let i = 0; i < w * h; i++) {
		const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
		g[i] = v;
		if (v < 18) dark++;
		if (v > 245) bright++;
	}
	let sum = 0,
		sum2 = 0,
		n = 0;
	for (let y = 1; y < h - 1; y++) {
		for (let x = 1; x < w - 1; x++) {
			const k = y * w + x;
			const lap = g[k - 1] + g[k + 1] + g[k - w] + g[k + w] - 4 * g[k];
			sum += lap;
			sum2 += lap * lap;
			n++;
		}
	}
	const blur = sum2 / n - (sum / n) ** 2;
	const warnings: QualityReport['warnings'] = [];
	if (bitmap.width < 1000 || bitmap.height < 700) {
		warnings.push({ id: 'size', message: 'This photo is small, so piece edges may be hard to read. Move closer or use a higher resolution.' });
	}
	if (blur < 40) warnings.push({ id: 'blur', message: 'The photo looks a little soft. Hold the camera steady and tap to focus.' });
	if (dark / (w * h) > 0.25) warnings.push({ id: 'dark', message: 'Some edges may be hard to read. Try brighter, softer light.' });
	if (bright / (w * h) > 0.08) warnings.push({ id: 'glare', message: 'There is glare on part of the photo. Tilt the light or the pieces to avoid reflections.' });
	return { width: bitmap.width, height: bitmap.height, blur, dark: dark / (w * h), bright: bright / (w * h), warnings };
}

export function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}
