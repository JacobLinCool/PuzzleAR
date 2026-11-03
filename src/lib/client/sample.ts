import { goto } from '$app/navigation';
import type { WorkspaceDoc } from '$lib/shared/doc';
import { api, rememberSession } from './api';
import { toast } from './toasts.svelte';

export const SAMPLE = 'sample-4x4';
export const sampleUrl = (file: string) => `/sample/${SAMPLE}/${file}`;

export interface SampleMeta {
	name: string;
	rows: number;
	cols: number;
	width: number;
	height: number;
	boardQuad: { x: number; y: number }[];
}

/** Creates a sample session: the sample photo plus a stored real SAM response. */
export async function startSample() {
	try {
		const meta = (await (await fetch(sampleUrl('meta.json'))).json()) as SampleMeta;
		const s = await api.createSession('demo');
		const doc: WorkspaceDoc = {
			...s.doc,
			state: 'PHOTO_READY',
			startedAt: Date.now(),
			photo: { mediaId: SAMPLE, url: sampleUrl('photo.jpg'), width: meta.width, height: meta.height, source: 'sample', warnings: [] },
			sample: { name: meta.name, boardQuad: meta.boardQuad }
		};
		await api.saveDoc(s.id, s.revision, doc);
		rememberSession({ id: s.id, createdAt: Date.now(), mode: 'demo', label: 'Sample puzzle' });
		await goto(`/p/${s.id}/review`);
	} catch (err) {
		toast((err as Error).message || 'Could not start the sample.', 'error');
	}
}
