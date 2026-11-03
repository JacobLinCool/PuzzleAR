import type { RequestHandler } from './$types';
import { apiError, env, json } from '$lib/server/http';
import { imageSize, sniffMime, stripJpegMetadata } from '$lib/server/image';
import { authorize } from '$lib/server/session';

const MAX_PIXELS = 30_000_000;

export const POST: RequestHandler = async (event) => {
	const row = await authorize(event, event.params.id);
	if (row instanceof Response) return row;
	const e = env(event);
	const kind = event.url.searchParams.get('kind') ?? 'initial';
	if (kind !== 'initial' && kind !== 'verification') return apiError('BAD_REQUEST', 'kind must be initial or verification', 400);
	const maxBytes = Number(e.MAX_IMAGE_UPLOAD_MB || 15) * 1024 * 1024;
	const declared = Number(event.request.headers.get('content-length') ?? 0);
	if (declared > maxBytes) return apiError('PAYLOAD_TOO_LARGE', 'Photos must be 15 MB or smaller.', 413);
	let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(await event.request.arrayBuffer());
	if (bytes.length > maxBytes) return apiError('PAYLOAD_TOO_LARGE', 'Photos must be 15 MB or smaller.', 413);
	const mime = sniffMime(bytes);
	if (!mime) return apiError('UNSUPPORTED_MEDIA', 'Please use a JPEG, PNG or WebP photo.', 415);
	const size = imageSize(bytes, mime);
	if (!size || !size.width || !size.height) return apiError('UNSUPPORTED_MEDIA', 'We could not read this photo.', 415);
	if (size.width * size.height > MAX_PIXELS) return apiError('PAYLOAD_TOO_LARGE', 'Photos must be 30 megapixels or smaller.', 413);
	if (mime === 'image/jpeg') bytes = stripJpegMetadata(bytes) as Uint8Array<ArrayBuffer>;

	const warnings: string[] = [];
	if (Math.max(size.width, size.height) < 1000 || Math.min(size.width, size.height) < 700) {
		warnings.push('This photo is small, so piece edges may be hard to read.');
	}
	const mediaId = crypto.randomUUID();
	const key = `sessions/${row.id}/media/${mediaId}`;
	await e.BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } });
	await e.DB.prepare(
		'INSERT INTO media (id, session_id, kind, r2_key, mime, width, height, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
	)
		.bind(mediaId, row.id, kind, key, mime, size.width, size.height, bytes.length, Date.now())
		.run();
	return json(
		{ mediaId, width: size.width, height: size.height, url: `/api/sessions/${row.id}/media/${mediaId}`, warnings },
		{ status: 201 }
	);
};
