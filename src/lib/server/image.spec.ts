import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageSize, sniffMime, stripJpegMetadata } from './image';

const photo = new Uint8Array(readFileSync(join(import.meta.dirname, '../../../fixtures/sample-3x3/photo.jpg')));

describe('upload checks', () => {
	it('sniffs magic bytes, not file names', () => {
		expect(sniffMime(photo)).toBe('image/jpeg');
		expect(sniffMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
	});
	it('reads JPEG dimensions from the frame header', () => {
		expect(imageSize(photo, 'image/jpeg')).toEqual({ width: 2048, height: 1536 });
	});
	it('drops EXIF/APP1 segments and keeps the image decodable', () => {
		// splice a fake EXIF segment with a GPS marker after SOI
		const exif = new Uint8Array([0xff, 0xe1, 0x00, 0x0c, ...new TextEncoder().encode('Exif\0\0GPS!')]);
		const withExif = new Uint8Array([...photo.subarray(0, 2), ...exif, ...photo.subarray(2)]);
		const out = stripJpegMetadata(withExif);
		expect(new TextDecoder('latin1').decode(out).includes('GPS!')).toBe(false);
		expect(imageSize(out, 'image/jpeg')).toEqual({ width: 2048, height: 1536 });
	});
});
