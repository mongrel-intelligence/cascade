import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock github client used in deleteInitialComment
const { mockDeletePRComment } = vi.hoisted(() => ({
	mockDeletePRComment: vi.fn(),
}));

vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		deletePRComment: mockDeletePRComment,
	},
}));

import {
	deleteInitialComment,
	getBaseBranch,
	getCardId,
	getProjectId,
	getSessionState,
	initSessionState,
	recordInitialComment,
	recordPRCreation,
	recordReviewSubmission,
} from '../../../src/gadgets/sessionState.js';

describe('initSessionState', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('initializes with required agentType and default baseBranch', () => {
		initSessionState('implementation');
		const state = getSessionState();

		expect(state.agentType).toBe('implementation');
		expect(state.baseBranch).toBe('main');
		expect(state.projectId).toBeNull();
		expect(state.cardId).toBeNull();
		expect(state.prCreated).toBe(false);
		expect(state.prUrl).toBeNull();
		expect(state.reviewSubmitted).toBe(false);
		expect(state.reviewUrl).toBeNull();
		expect(state.initialCommentId).toBeNull();
		expect(state.hooks).toEqual({});
	});

	it('initializes with all parameters', () => {
		const hooks = { requiresPR: true, requiresReview: false };
		initSessionState('review', 'develop', 'project-123', 'card-456', hooks);
		const state = getSessionState();

		expect(state.agentType).toBe('review');
		expect(state.baseBranch).toBe('develop');
		expect(state.projectId).toBe('project-123');
		expect(state.cardId).toBe('card-456');
		expect(state.hooks).toEqual(hooks);
	});

	it('uses "main" as default baseBranch when undefined provided', () => {
		initSessionState('splitting', undefined, 'proj-1');
		expect(getBaseBranch()).toBe('main');
	});

	it('resets state on each call', () => {
		initSessionState('implementation');
		recordPRCreation('https://github.com/test/pr/1');
		initSessionState('review');

		const state = getSessionState();
		expect(state.prCreated).toBe(false);
		expect(state.prUrl).toBeNull();
	});
});

describe('getters', () => {
	beforeEach(() => {
		initSessionState('implementation', 'feature-branch', 'proj-abc', 'card-xyz');
	});

	it('getBaseBranch returns the base branch', () => {
		expect(getBaseBranch()).toBe('feature-branch');
	});

	it('getProjectId returns the project id', () => {
		expect(getProjectId()).toBe('proj-abc');
	});

	it('getCardId returns the card id', () => {
		expect(getCardId()).toBe('card-xyz');
	});
});

describe('recordPRCreation', () => {
	beforeEach(() => {
		initSessionState('implementation');
	});

	it('sets prCreated=true and stores prUrl', () => {
		recordPRCreation('https://github.com/owner/repo/pull/42');
		const state = getSessionState();

		expect(state.prCreated).toBe(true);
		expect(state.prUrl).toBe('https://github.com/owner/repo/pull/42');
	});
});

describe('recordReviewSubmission', () => {
	beforeEach(() => {
		initSessionState('review');
	});

	it('sets reviewSubmitted=true and stores reviewUrl', () => {
		recordReviewSubmission('https://github.com/owner/repo/pull/42#pullrequestreview-1');
		const state = getSessionState();

		expect(state.reviewSubmitted).toBe(true);
		expect(state.reviewUrl).toBe('https://github.com/owner/repo/pull/42#pullrequestreview-1');
	});
});

describe('recordInitialComment', () => {
	beforeEach(() => {
		initSessionState('implementation');
	});

	it('stores the comment id', () => {
		recordInitialComment(12345);
		const state = getSessionState();

		expect(state.initialCommentId).toBe(12345);
	});
});

describe('deleteInitialComment', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		initSessionState('implementation');
	});

	it('does nothing when no initial comment id', async () => {
		await deleteInitialComment('owner', 'repo');

		expect(mockDeletePRComment).not.toHaveBeenCalled();
	});

	it('calls github deletePRComment with correct args', async () => {
		recordInitialComment(99);
		mockDeletePRComment.mockResolvedValue(undefined);

		await deleteInitialComment('my-owner', 'my-repo');

		expect(mockDeletePRComment).toHaveBeenCalledWith('my-owner', 'my-repo', 99);
	});

	it('clears initialCommentId on success', async () => {
		recordInitialComment(99);
		mockDeletePRComment.mockResolvedValue(undefined);

		await deleteInitialComment('owner', 'repo');

		expect(getSessionState().initialCommentId).toBeNull();
	});

	it('restores initialCommentId on error', async () => {
		recordInitialComment(99);
		mockDeletePRComment.mockRejectedValue(new Error('Network error'));

		await deleteInitialComment('owner', 'repo');

		// Should restore the id for retry
		expect(getSessionState().initialCommentId).toBe(99);
	});
});

describe('getSessionState', () => {
	beforeEach(() => {
		initSessionState('implementation', 'main', 'proj-1', 'card-1');
	});

	it('returns a copy (not the original reference)', () => {
		const state1 = getSessionState();
		const state2 = getSessionState();

		expect(state1).not.toBe(state2);
		expect(state1).toEqual(state2);
	});

	it('mutations to returned state do not affect internal state', () => {
		const state = getSessionState();
		(state as Record<string, unknown>).prCreated = true;
		(state as Record<string, unknown>).prUrl = 'https://fake-url';

		const freshState = getSessionState();
		expect(freshState.prCreated).toBe(false);
		expect(freshState.prUrl).toBeNull();
	});
});
