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
	getWorkItemTitle,
	getWorkItemUrl,
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
		initSessionState({ agentType: 'implementation' });
		const state = getSessionState();

		expect(state.agentType).toBe('implementation');
		expect(state.baseBranch).toBe('main');
		expect(state.projectId).toBeNull();
		expect(state.cardId).toBeNull();
		expect(state.initialHeadSha).toBeNull();
		expect(state.prCreated).toBe(false);
		expect(state.prUrl).toBeNull();
		expect(state.reviewSubmitted).toBe(false);
		expect(state.reviewUrl).toBeNull();
		expect(state.initialCommentId).toBeNull();
		expect(state.hooks).toEqual({});
	});

	it('initializes with all parameters', () => {
		const hooks = { requiresPR: true, requiresReview: false };
		initSessionState({
			agentType: 'review',
			baseBranch: 'develop',
			projectId: 'project-123',
			cardId: 'card-456',
			hooks,
		});
		const state = getSessionState();

		expect(state.agentType).toBe('review');
		expect(state.baseBranch).toBe('develop');
		expect(state.projectId).toBe('project-123');
		expect(state.cardId).toBe('card-456');
		expect(state.hooks).toEqual(hooks);
	});

	it('uses "main" as default baseBranch when undefined provided', () => {
		initSessionState({ agentType: 'splitting', projectId: 'proj-1' });
		expect(getBaseBranch()).toBe('main');
	});

	it('resets state on each call', () => {
		initSessionState({ agentType: 'implementation' });
		recordPRCreation('https://github.com/test/pr/1');
		initSessionState({ agentType: 'review' });

		const state = getSessionState();
		expect(state.prCreated).toBe(false);
		expect(state.prUrl).toBeNull();
	});
});

describe('getters', () => {
	beforeEach(() => {
		initSessionState({
			agentType: 'implementation',
			baseBranch: 'feature-branch',
			projectId: 'proj-abc',
			cardId: 'card-xyz',
		});
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

	it('getWorkItemUrl returns null when not set', () => {
		expect(getWorkItemUrl()).toBeNull();
	});

	it('getWorkItemTitle returns null when not set', () => {
		expect(getWorkItemTitle()).toBeNull();
	});
});

describe('workItemUrl and workItemTitle', () => {
	it('stores workItemUrl and workItemTitle when provided to initSessionState', () => {
		initSessionState({
			agentType: 'implementation',
			baseBranch: 'main',
			projectId: 'proj-1',
			cardId: 'card-1',
			workItemUrl: 'https://trello.com/c/abc123',
			workItemTitle: 'My Feature Card',
		});
		expect(getWorkItemUrl()).toBe('https://trello.com/c/abc123');
		expect(getWorkItemTitle()).toBe('My Feature Card');
	});

	it('returns null for workItemUrl and workItemTitle when not provided', () => {
		initSessionState({
			agentType: 'implementation',
			baseBranch: 'main',
			projectId: 'proj-1',
			cardId: 'card-1',
		});
		expect(getWorkItemUrl()).toBeNull();
		expect(getWorkItemTitle()).toBeNull();
	});

	it('resets workItemUrl and workItemTitle on subsequent initSessionState call', () => {
		initSessionState({
			agentType: 'implementation',
			baseBranch: 'main',
			projectId: 'proj-1',
			cardId: 'card-1',
			workItemUrl: 'https://trello.com/c/abc',
			workItemTitle: 'Card A',
		});
		initSessionState({ agentType: 'implementation' });
		expect(getWorkItemUrl()).toBeNull();
		expect(getWorkItemTitle()).toBeNull();
	});
});

describe('initialHeadSha', () => {
	it('stores initialHeadSha when passed to initSessionState', () => {
		initSessionState({
			agentType: 'respond-to-ci',
			baseBranch: 'main',
			projectId: 'proj-1',
			cardId: 'card-1',
			initialHeadSha: 'abc123sha',
		});
		expect(getSessionState().initialHeadSha).toBe('abc123sha');
	});

	it('defaults to null when not provided', () => {
		initSessionState({ agentType: 'implementation' });
		expect(getSessionState().initialHeadSha).toBeNull();
	});

	it('resets to null on re-init without the param', () => {
		initSessionState({
			agentType: 'respond-to-ci',
			baseBranch: 'main',
			projectId: 'proj-1',
			cardId: 'card-1',
			initialHeadSha: 'abc123sha',
		});
		initSessionState({ agentType: 'implementation' });
		expect(getSessionState().initialHeadSha).toBeNull();
	});
});

describe('recordPRCreation', () => {
	beforeEach(() => {
		initSessionState({ agentType: 'implementation' });
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
		initSessionState({ agentType: 'review' });
	});

	it('sets reviewSubmitted=true and stores reviewUrl', () => {
		recordReviewSubmission('https://github.com/owner/repo/pull/42#pullrequestreview-1');
		const state = getSessionState();

		expect(state.reviewSubmitted).toBe(true);
		expect(state.reviewUrl).toBe('https://github.com/owner/repo/pull/42#pullrequestreview-1');
	});

	it('stores reviewBody and reviewEvent when provided', () => {
		recordReviewSubmission(
			'https://github.com/owner/repo/pull/42#pullrequestreview-1',
			'LGTM! Well done.',
			'APPROVE',
		);
		const state = getSessionState();

		expect(state.reviewBody).toBe('LGTM! Well done.');
		expect(state.reviewEvent).toBe('APPROVE');
	});

	it('sets reviewBody and reviewEvent to null when not provided', () => {
		recordReviewSubmission('https://github.com/owner/repo/pull/42#pullrequestreview-1');
		const state = getSessionState();

		expect(state.reviewBody).toBeNull();
		expect(state.reviewEvent).toBeNull();
	});

	it('resets reviewBody and reviewEvent on initSessionState', () => {
		recordReviewSubmission(
			'https://github.com/owner/repo/pull/42#pullrequestreview-1',
			'LGTM!',
			'APPROVE',
		);
		initSessionState({ agentType: 'review' });
		const state = getSessionState();

		expect(state.reviewBody).toBeNull();
		expect(state.reviewEvent).toBeNull();
	});
});

describe('recordInitialComment', () => {
	beforeEach(() => {
		initSessionState({ agentType: 'implementation' });
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
		initSessionState({ agentType: 'implementation' });
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
		initSessionState({
			agentType: 'implementation',
			baseBranch: 'main',
			projectId: 'proj-1',
			cardId: 'card-1',
		});
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
