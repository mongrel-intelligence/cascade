import { describe, expect, it } from 'vitest';

import {
	isGitLabMergeRequestPayload,
	isGitLabNotePayload,
	isGitLabPipelinePayload,
} from '../../../../src/triggers/gitlab/types.js';

// ---------------------------------------------------------------------------
// Test payloads
// ---------------------------------------------------------------------------

function makeMRPayload(overrides: Record<string, unknown> = {}) {
	return {
		object_kind: 'merge_request',
		event_type: 'merge_request',
		user: { username: 'author' },
		project: { path_with_namespace: 'group/repo', id: 1 },
		object_attributes: {
			iid: 42,
			title: 'Test MR',
			description: null,
			source_branch: 'feature/test',
			target_branch: 'main',
			state: 'opened',
			action: 'open',
			work_in_progress: false,
			url: 'https://gitlab.com/group/repo/-/merge_requests/42',
			last_commit: { id: 'abc123' },
			author_id: 1,
		},
		repository: { name: 'repo', url: 'https://gitlab.com/group/repo.git' },
		...overrides,
	};
}

function makePipelinePayload(overrides: Record<string, unknown> = {}) {
	return {
		object_kind: 'pipeline',
		object_attributes: {
			id: 100,
			ref: 'feature/test',
			sha: 'abc123',
			status: 'success',
			stages: ['build', 'test'],
		},
		user: { username: 'author' },
		project: { path_with_namespace: 'group/repo', id: 1 },
		...overrides,
	};
}

function makeNotePayload(overrides: Record<string, unknown> = {}) {
	return {
		object_kind: 'note',
		event_type: 'note',
		user: { username: 'commenter' },
		project: { path_with_namespace: 'group/repo', id: 1 },
		object_attributes: {
			id: 200,
			note: 'A comment',
			noteable_type: 'MergeRequest',
			author_id: 2,
			url: 'https://gitlab.com/group/repo/-/merge_requests/42#note_200',
		},
		repository: { name: 'repo', url: 'https://gitlab.com/group/repo.git' },
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitLab type guards', () => {
	describe('isGitLabMergeRequestPayload', () => {
		it('returns true for a valid merge request payload', () => {
			expect(isGitLabMergeRequestPayload(makeMRPayload())).toBe(true);
		});

		it('returns false for a pipeline payload', () => {
			expect(isGitLabMergeRequestPayload(makePipelinePayload())).toBe(false);
		});

		it('returns false for a note payload', () => {
			expect(isGitLabMergeRequestPayload(makeNotePayload())).toBe(false);
		});

		it('returns false for null', () => {
			expect(isGitLabMergeRequestPayload(null)).toBe(false);
		});

		it('returns false for a non-object', () => {
			expect(isGitLabMergeRequestPayload('string')).toBe(false);
		});

		it('returns false when object_attributes is missing', () => {
			expect(
				isGitLabMergeRequestPayload({
					object_kind: 'merge_request',
					project: { path_with_namespace: 'a/b', id: 1 },
				}),
			).toBe(false);
		});

		it('returns false when project is missing', () => {
			expect(
				isGitLabMergeRequestPayload({
					object_kind: 'merge_request',
					object_attributes: { iid: 1 },
				}),
			).toBe(false);
		});
	});

	describe('isGitLabPipelinePayload', () => {
		it('returns true for a valid pipeline payload', () => {
			expect(isGitLabPipelinePayload(makePipelinePayload())).toBe(true);
		});

		it('returns false for a merge request payload', () => {
			expect(isGitLabPipelinePayload(makeMRPayload())).toBe(false);
		});

		it('returns false for null', () => {
			expect(isGitLabPipelinePayload(null)).toBe(false);
		});

		it('returns false for a non-object', () => {
			expect(isGitLabPipelinePayload(42)).toBe(false);
		});

		it('returns false when object_attributes is missing', () => {
			expect(
				isGitLabPipelinePayload({
					object_kind: 'pipeline',
					project: { path_with_namespace: 'a/b', id: 1 },
				}),
			).toBe(false);
		});

		it('returns false when project is missing', () => {
			expect(
				isGitLabPipelinePayload({
					object_kind: 'pipeline',
					object_attributes: { id: 1 },
				}),
			).toBe(false);
		});
	});

	describe('isGitLabNotePayload', () => {
		it('returns true for a valid note payload', () => {
			expect(isGitLabNotePayload(makeNotePayload())).toBe(true);
		});

		it('returns false for a merge request payload', () => {
			expect(isGitLabNotePayload(makeMRPayload())).toBe(false);
		});

		it('returns false for null', () => {
			expect(isGitLabNotePayload(null)).toBe(false);
		});

		it('returns false for undefined', () => {
			expect(isGitLabNotePayload(undefined)).toBe(false);
		});

		it('returns false when object_attributes is missing', () => {
			expect(
				isGitLabNotePayload({
					object_kind: 'note',
					project: { path_with_namespace: 'a/b', id: 1 },
				}),
			).toBe(false);
		});

		it('returns false when project is missing', () => {
			expect(
				isGitLabNotePayload({
					object_kind: 'note',
					object_attributes: { id: 1 },
				}),
			).toBe(false);
		});
	});
});
