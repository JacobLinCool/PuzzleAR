/**
 * Calls Meta SAM 3.1 on a local image and stores the raw SSE stream so the demo
 * and tests can replay a real response. Usage:
 *   pnpm tsx tools/sam-spike.ts fixtures/sample-4x4/photo.jpg [prompt]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseImageStream, recordsOfKind, decodeMaskToRaster } from '@meta-sam/parser';
import { sseEvents } from '../src/lib/sam/sse';

const key =
	process.env.MODEL_API_KEY ??
	readFileSync('.dev.vars', 'utf8').match(/MODEL_API_KEY=(.*)/)?.[1]?.trim();
const file = process.argv[2];
const prompt = process.argv[3] ?? 'jigsaw puzzle piece';
const mime = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
const dataUrl = `data:${mime};base64,${readFileSync(file).toString('base64')}`;

const t0 = Date.now();
const res = await fetch('https://api.meta.ai/v1/responses', {
	method: 'POST',
	headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
	body: JSON.stringify({
		model: 'sam-3.1',
		input: [
			{
				type: 'message',
				role: 'user',
				content: [
					{ type: 'input_text', text: prompt },
					{ type: 'input_image', image_url: dataUrl }
				]
			}
		],
		stream: true,
		metadata: { mask_encoding: 'one_bit', include_confidence: 'true' }
	})
});
console.log('status', res.status, [...res.headers].filter(([k]) => /request|ratelimit|retry/i.test(k)));
if (!res.ok || !res.body) {
	console.log(await res.text());
	process.exit(1);
}
let raw = '';
const parsed = parseImageStream(sseEvents(res.body, (c) => (raw += c)) as never);
const result = await parsed.finalResult;
console.log('elapsed', Date.now() - t0, 'ms', 'outcome', result.outcome);
const boxes = recordsOfKind(result.records, 'box');
const masks = recordsOfKind(result.records, 'mask');
console.log('boxes', boxes.length, 'masks', masks.length, 'diagnostics', result.diagnostics);
for (const m of masks.slice(0, 3)) {
	const r = decodeMaskToRaster(m.mask);
	const area = r.reduce((a, b) => a + b, 0);
	console.log(m.objectId, m.confidence, m.bounds, m.mask.width, m.mask.height, 'area', area);
}
console.log(raw.slice(0, 600));
if (process.argv[4]) writeFileSync(process.argv[4], raw);
