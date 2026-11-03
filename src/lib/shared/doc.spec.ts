import { describe, expect, it } from 'vitest';
import { emptyDoc, validateDoc, type WorkspaceDoc } from './doc';

function withPiece(doc: WorkspaceDoc): WorkspaceDoc {
	return {
		...doc,
		pieces: [{ id: 'p1', label: 1, origin: 'segment', status: 'accepted', maskKey: 'p1@1', version: 1 }],
		masks: { 'p1@1': { left: 0, top: 0, width: 1, height: 1, rle: [0, 1] } }
	};
}

describe('server-side document validation', () => {
	it('rejects skipping states', () => {
		const prev = emptyDoc('upload');
		expect(validateDoc(prev, { ...prev, state: 'GUIDING' })).toMatch(/Cannot go from NEW to GUIDING/);
	});
	it('requires a solution before guiding', () => {
		const prev = { ...withPiece(emptyDoc('upload')), state: 'REVIEW' as const, photo: { mediaId: 'm', url: '/x', width: 1, height: 1, source: 'upload' as const, warnings: [] }, segment: { prompt: 'p', count: 1, at: 0, preprocessed: false } };
		expect(validateDoc(prev, { ...prev, state: 'SOLUTION_READY' })).toMatch(/solution is required/);
	});
	it('never lets a piece id disappear', () => {
		const prev = withPiece(emptyDoc('upload'));
		expect(validateDoc(prev, { ...prev, pieces: [] })).toMatch(/only removed/);
	});
	it('allows undo to jump back to an earlier state', () => {
		const prev = { ...emptyDoc('upload'), state: 'PHOTO_READY' as const };
		expect(validateDoc(prev, { ...prev, state: 'NEW' }, { allowAnyTransition: true })).toBeNull();
	});
});
