import type { RGBAImage } from './types';

function lin(c: number): number {
	c /= 255;
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const LUT = new Float64Array(256);
for (let i = 0; i < 256; i++) LUT[i] = lin(i);

function f(t: number): number {
	return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

/** sRGB (0-255, may be fractional) to CIE Lab (D65). */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
	const R = lin(r),
		G = lin(g),
		B = lin(b);
	const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
	const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
	const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
	const fx = f(x),
		fy = f(y),
		fz = f(z);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Bilinear RGB sample; returns null outside the image. */
export function sampleRGB(img: RGBAImage, x: number, y: number): [number, number, number] | null {
	const x0 = Math.floor(x - 0.5);
	const y0 = Math.floor(y - 0.5);
	if (x0 < 0 || y0 < 0 || x0 + 1 >= img.width || y0 + 1 >= img.height) return null;
	const fx = x - 0.5 - x0;
	const fy = y - 0.5 - y0;
	const w = img.width;
	const d = img.data;
	const out: [number, number, number] = [0, 0, 0];
	for (let c = 0; c < 3; c++) {
		const a = d[(y0 * w + x0) * 4 + c];
		const b = d[(y0 * w + x0 + 1) * 4 + c];
		const e = d[((y0 + 1) * w + x0) * 4 + c];
		const g = d[((y0 + 1) * w + x0 + 1) * 4 + c];
		out[c] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + e * (1 - fx) * fy + g * fx * fy;
	}
	return out;
}

export function luma(img: RGBAImage, x: number, y: number): number {
	const i = (Math.floor(y) * img.width + Math.floor(x)) * 4;
	return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
}

export function labToRgb(L: number, a: number, b: number): [number, number, number] {
	const fy = (L + 16) / 116;
	const fx = fy + a / 500;
	const fz = fy - b / 200;
	const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
	const x = inv(fx) * 0.95047;
	const y = inv(fy);
	const z = inv(fz) * 1.08883;
	const R = x * 3.2406 + y * -1.5372 + z * -0.4986;
	const G = x * -0.9689 + y * 1.8758 + z * 0.0415;
	const B = x * 0.0557 + y * -0.204 + z * 1.057;
	const g = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)));
	return [g(R), g(G), g(B)];
}

export { LUT as SRGB_TO_LINEAR };
