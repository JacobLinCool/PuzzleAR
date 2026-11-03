/**
 * Contact sheet of every piece in a photo: SAM outline, chosen corners and side
 * types, for eyeballing real photos without ground truth.
 * Usage: pnpm tsx tools/sheet.ts <dir with photo.jpg + sam-stream.txt> <out.png>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { masksFromResult, parseSamStream, textStream } from '../src/lib/sam/masks';
import { analyzeAll } from '../src/lib/vision/analyze';

const [dir, out] = process.argv.slice(2);
const photo = await loadImage(readFileSync(join(dir, 'photo.jpg')));
const c0 = createCanvas(photo.width, photo.height);
c0.getContext('2d').drawImage(photo, 0, 0);
const rgba = { width: photo.width, height: photo.height, data: c0.getContext('2d').getImageData(0, 0, photo.width, photo.height).data };
const sam = masksFromResult(await parseSamStream(textStream(readFileSync(join(dir, 'sam-stream.txt'), 'utf8'))));
const color = { flat: '#888', tab: '#0a8', socket: '#e80', unknown: '#e22' } as Record<string, string>;
const T = 240, cols = 7;
const sheet = createCanvas(cols * T, Math.ceil(sam.length / cols) * T);
const ctx = sheet.getContext('2d');
ctx.fillStyle = '#fff';
ctx.fillRect(0, 0, sheet.width, sheet.height);
const summary: string[] = [];
const all = analyzeAll(rgba, sam.map((s) => ({ mask: s.mask })));
console.log('rectify', all.rectify?.map((v) => v.toFixed(3)).join(' ') ?? 'none');
let flagged = 0;
sam.forEach((s, i) => {
	const g = all.geoms[i] as import('../src/lib/vision/types').PieceGeometry;
	if (g.issues.length) flagged++;
	const m = s.mask;
	const k = (T - 30) / Math.max(m.width, m.height);
	const ox = (i % cols) * T + 15, oy = Math.floor(i / cols) * T + 15;
	ctx.drawImage(photo, m.left, m.top, m.width, m.height, ox, oy, m.width * k, m.height * k);
	const P = (p: { x: number; y: number }) => [ox + (p.x - m.left) * k, oy + (p.y - m.top) * k] as const;
	ctx.lineWidth = 3;
	g.sides.forEach((sd) => {
		ctx.strokeStyle = color[sd.type];
		ctx.beginPath();
		sd.framePts.forEach((p, j) => (j ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
		ctx.stroke();
	});
	ctx.fillStyle = '#22f';
	g.corners.forEach((p) => {
		ctx.beginPath();
		ctx.arc(...P(p), 5, 0, 7);
		ctx.fill();
	});
	ctx.fillStyle = '#000';
	ctx.font = '16px sans-serif';
	ctx.fillText(`${i} ${g.sides.map((x) => x.type[0]).join('')} ${g.cornersOk ? '' : 'C?'} ${s.confidence?.toFixed(2)}`, ox, oy + T - 22);
	summary.push(g.sides.map((x) => x.type[0]).join(''));
});
writeFileSync(out, sheet.toBuffer('image/png'));
const flats = summary.join('').split('').filter((x) => x === 'f').length;
console.log('pieces', sam.length, 'unknown sides', summary.join('').split('').filter((x) => x === 'u').length, 'flat sides', flats, 'flagged for review', flagged);
