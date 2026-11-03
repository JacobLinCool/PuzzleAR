import type { WorkspaceDoc } from '$lib/shared/doc';

export class ApiError extends Error {
	constructor(
		public code: string,
		message: string,
		public status: number,
		public retryable = false,
		public action?: string
	) {
		super(message);
	}
}

/** Friendly copy for codes the UI can hit before the server answers. */
export const CLIENT_ERRORS: Record<string, string> = {
	NETWORK: 'We could not reach PuzzleAR. Check your connection; your work is saved.',
	CAMERA_DENIED: 'Camera access was blocked. You can still upload a photo.',
	CAMERA_UNAVAILABLE: 'No camera is available here. You can still upload a photo.',
	NO_MASKS: 'We couldn’t see the pieces clearly.',
	SAM_INCOMPLETE: 'The scan stopped before it finished. Try again.'
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, { credentials: 'same-origin', ...init });
	} catch {
		throw new ApiError('NETWORK', CLIENT_ERRORS.NETWORK, 0, true);
	}
	if (!res.ok) throw await toError(res);
	return (await res.json()) as T;
}

export async function toError(res: Response): Promise<ApiError> {
	try {
		const body = (await res.json()) as { error?: { code: string; message: string; retryable?: boolean; action?: string } };
		if (body.error) return new ApiError(body.error.code, body.error.message, res.status, body.error.retryable, body.error.action);
	} catch {
		/* not JSON */
	}
	return new ApiError('INTERNAL', 'Something went wrong on our side. Your work is saved.', res.status, true);
}

export interface SessionPayload {
	id: string;
	mode: WorkspaceDoc['mode'];
	state: WorkspaceDoc['state'];
	revision: number;
	createdAt: number;
	expiresAt: number;
	scannerAvailable: boolean;
	doc: WorkspaceDoc;
}

export const api = {
	createSession: (mode: 'camera' | 'upload' | 'demo') =>
		request<{ id: string; revision: number; createdAt: number; doc: WorkspaceDoc }>('/api/sessions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ mode })
		}),
	getSession: (id: string) => request<SessionPayload>(`/api/sessions/${id}`),
	saveDoc: (id: string, revision: number, doc: WorkspaceDoc, history?: 'undo' | 'redo') =>
		request<{ revision: number }>(`/api/sessions/${id}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ revision, doc, history })
		}),
	deleteSession: (id: string) => request<{ deleted: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),
	uploadMedia: (id: string, blob: Blob, kind: 'initial' | 'verification' = 'initial') =>
		request<{ mediaId: string; width: number; height: number; url: string; warnings: string[] }>(
			`/api/sessions/${id}/media?kind=${kind}`,
			{ method: 'POST', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob }
		),
	status: () => request<{ scannerAvailable: boolean }>('/api/status'),
	/** Starts a SAM call and returns the raw SSE response for streaming parse. */
	async sam(id: string, kind: 'segment' | 'refine', body: unknown, signal?: AbortSignal): Promise<Response> {
		let res: Response;
		try {
			res = await fetch(`/api/sessions/${id}/${kind}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				signal
			});
		} catch (err) {
			if ((err as Error).name === 'AbortError') throw err;
			throw new ApiError('NETWORK', CLIENT_ERRORS.NETWORK, 0, true);
		}
		if (!res.ok || !res.body) throw await toError(res);
		return res;
	}
};

/** Sessions this browser created, for the resume list and the privacy page. */
const RECENT_KEY = 'puzzlear:recent';
export interface RecentSession {
	id: string;
	createdAt: number;
	mode: string;
	label?: string;
}
export function recentSessions(): RecentSession[] {
	try {
		const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as RecentSession[];
		return list.filter((s) => Date.now() - s.createdAt < 24 * 3600_000);
	} catch {
		return [];
	}
}
export function rememberSession(s: RecentSession) {
	try {
		const list = recentSessions().filter((x) => x.id !== s.id);
		localStorage.setItem(RECENT_KEY, JSON.stringify([s, ...list].slice(0, 8)));
	} catch {
		/* storage unavailable */
	}
}
export function forgetSession(id: string) {
	try {
		localStorage.setItem(RECENT_KEY, JSON.stringify(recentSessions().filter((x) => x.id !== id)));
	} catch {
		/* storage unavailable */
	}
}
