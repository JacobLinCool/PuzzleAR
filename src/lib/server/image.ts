/** Magic-byte sniffing, dimension parsing and JPEG metadata stripping. */

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export function sniffMime(b: Uint8Array): ImageMime | null {
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
	if (
		b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
		b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
	)
		return 'image/webp';
	return null;
}

export function imageSize(b: Uint8Array, mime: ImageMime): { width: number; height: number } | null {
	const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
	if (mime === 'image/png') {
		if (b.length < 24) return null;
		return { width: dv.getUint32(16), height: dv.getUint32(20) };
	}
	if (mime === 'image/webp') {
		const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
		if (chunk === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
		if (chunk === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
		if (chunk === 'VP8L') {
			const bits = dv.getUint32(21, true);
			return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
		}
		return null;
	}
	let i = 2;
	while (i + 9 < b.length) {
		if (b[i] !== 0xff) return null;
		const marker = b[i + 1];
		const len = dv.getUint16(i + 2);
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
		}
		i += 2 + len;
	}
	return null;
}

/**
 * Removes APP1-APP15 and COM segments (EXIF, GPS, XMP, comments) from a JPEG
 * without re-encoding. Keeps APP0 (JFIF) and everything from SOS onwards.
 */
export function stripJpegMetadata(b: Uint8Array): Uint8Array {
	const out: Uint8Array[] = [b.subarray(0, 2)];
	let i = 2;
	while (i + 4 <= b.length) {
		if (b[i] !== 0xff) break;
		const marker = b[i + 1];
		if (marker === 0xda) break; // start of scan: copy the rest verbatim
		const len = (b[i + 2] << 8) | b[i + 3];
		const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
		if (!drop) out.push(b.subarray(i, i + 2 + len));
		i += 2 + len;
	}
	out.push(b.subarray(i));
	const total = out.reduce((s, p) => s + p.length, 0);
	const res = new Uint8Array(total);
	let o = 0;
	for (const p of out) {
		res.set(p, o);
		o += p.length;
	}
	return res;
}
