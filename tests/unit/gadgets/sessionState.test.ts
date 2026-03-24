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
	SessionState,
	clearInitialComment,
	createSessionState,
	deleteInitialComment,
	getBaseBranch,
	getProjectId,
	getSessionState,
	getWorkItemId,
	getWorkItemTitle,
	getWorkItemUrl,
	initSessionState,
	recordInitialComment,
	recordPRCreation,
	recordReviewSubmission,
	setDefaultSessionState,
} from '../../../src/gadgets/sessionState.js';

// ---------------------------------------------------------------------------
// Module-level backward-compatible function tests (original suite)
// ---------------------------------------------------------------------------

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
		expect(state.workItemId).toBeNull();
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
			workItemId: 'card-456',
			hooks,
		});
		const state = getSessionState();

		expect(state.agentType).toBe('review');
		expect(state.baseBranch).toBe('develop');
		expect(state.projectId).toBe('project-123');
		expect(state.workItemId).toBe('card-456');
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
			workItemId: 'card-xyz',
		});
	});

	it('getBaseBranch returns the base branch', () => {
		expect(getBaseBranch()).toBe('feature-branch');
	});

	it('getProjectId returns the project id', () => {
		expect(getProjectId()).toBe('proj-abc');
	});

	it('getWorkItemId returns the work item id', () => {
		expect(getWorkItemId()).toBe('card-xyz');
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
			workItemId: 'card-1',
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
			workItemId: 'card-1',
		});
		expect(getWorkItemUrl()).toBeNull();
		expect(getWorkItemTitle()).toBeNull();
	});

	it('resets workItemUrl and workItemTitle on subsequent initSessionState call', () => {
		initSessionState({
			agentType: 'implementation',
			baseBranch: 'main',
			projectId: 'proj-1',
			workItemId: 'card-1',
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
			workItemId: 'card-1',
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
			workItemId: 'card-1',
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
			workItemId: 'card-1',
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

// ---------------------------------------------------------------------------
// SessionState class interface tests
// ---------------------------------------------------------------------------

describe('SessionState class', () => {
	let ss: SessionState;

	beforeEach(() => {
		ss = new SessionState();
	});

	it('starts with default state', () => {
		const state = ss.getSessionState();
		expect(state.agentType).toBeNull();
		expect(state.baseBranch).toBe('main');
		expect(state.projectId).toBeNull();
		expect(state.workItemId).toBeNull();
		expect(state.prCreated).toBe(false);
		expect(state.prUrl).toBeNull();
		expect(state.reviewSubmitted).toBe(false);
		expect(state.initialCommentId).toBeNull();
		expect(state.hooks).toEqual({});
	});

	it('init() sets all fields correctly', () => {
		ss.init({
			agentType: 'implementation',
			baseBranch: 'develop',
			projectId: 'proj-1',
			workItemId: 'card-1',
			workItemUrl: 'https://trello.com/c/abc',
			workItemTitle: 'My Card',
			initialHeadSha: 'sha123',
			hooks: { requiresPR: true },
		});
		const state = ss.getSessionState();
		expect(state.agentType).toBe('implementation');
		expect(state.baseBranch).toBe('develop');
		expect(state.projectId).toBe('proj-1');
		expect(state.workItemId).toBe('card-1');
		expect(state.workItemUrl).toBe('https://trello.com/c/abc');
		expect(state.workItemTitle).toBe('My Card');
		expect(state.initialHeadSha).toBe('sha123');
		expect(state.hooks).toEqual({ requiresPR: true });
	});

	it('init() resets mutable fields on each call', () => {
		ss.init({ agentType: 'implementation' });
		ss.recordPRCreation('https://github.com/pr/1');
		ss.recordInitialComment(42);
		ss.init({ agentType: 'review' });
		const state = ss.getSessionState();
		expect(state.prCreated).toBe(false);
		expect(state.prUrl).toBeNull();
		expect(state.initialCommentId).toBeNull();
	});

	it('getBaseBranch() returns current base branch', () => {
		ss.init({ agentType: 'implementation', baseBranch: 'feature/foo' });
		expect(ss.getBaseBranch()).toBe('feature/foo');
	});

	it('getProjectId() returns project id', () => {
		ss.init({ agentType: 'implementation', projectId: 'p-123' });
		expect(ss.getProjectId()).toBe('p-123');
	});

	it('getWorkItemId() returns work item id', () => {
		ss.init({ agentType: 'implementation', workItemId: 'w-999' });
		expect(ss.getWorkItemId()).toBe('w-999');
	});

	it('getWorkItemUrl() returns null when not set', () => {
		ss.init({ agentType: 'implementation' });
		expect(ss.getWorkItemUrl()).toBeNull();
	});

	it('getWorkItemTitle() returns null when not set', () => {
		ss.init({ agentType: 'implementation' });
		expect(ss.getWorkItemTitle()).toBeNull();
	});

	it('setReadOnlyFs() updates readOnlyFs', () => {
		ss.init({ agentType: 'implementation' });
		expect(ss.getSessionState().readOnlyFs).toBe(false);
		ss.setReadOnlyFs(true);
		expect(ss.getSessionState().readOnlyFs).toBe(true);
		ss.setReadOnlyFs(false);
		expect(ss.getSessionState().readOnlyFs).toBe(false);
	});

	it('recordPRCreation() sets prCreated and prUrl', () => {
		ss.init({ agentType: 'implementation' });
		ss.recordPRCreation('https://github.com/owner/repo/pull/7');
		const state = ss.getSessionState();
		expect(state.prCreated).toBe(true);
		expect(state.prUrl).toBe('https://github.com/owner/repo/pull/7');
	});

	it('recordReviewSubmission() sets review fields', () => {
		ss.init({ agentType: 'review' });
		ss.recordReviewSubmission('https://github.com/pr/1#review-1', 'LGTM', 'APPROVE');
		const state = ss.getSessionState();
		expect(state.reviewSubmitted).toBe(true);
		expect(state.reviewUrl).toBe('https://github.com/pr/1#review-1');
		expect(state.reviewBody).toBe('LGTM');
		expect(state.reviewEvent).toBe('APPROVE');
	});

	it('recordReviewSubmission() defaults body/event to null', () => {
		ss.init({ agentType: 'review' });
		ss.recordReviewSubmission('https://github.com/pr/1#review-1');
		const state = ss.getSessionState();
		expect(state.reviewBody).toBeNull();
		expect(state.reviewEvent).toBeNull();
	});

	it('recordInitialComment() stores comment id', () => {
		ss.init({ agentType: 'implementation' });
		ss.recordInitialComment(7777);
		expect(ss.getSessionState().initialCommentId).toBe(7777);
	});

	it('clearInitialComment() sets initialCommentId to null', () => {
		ss.init({ agentType: 'implementation' });
		ss.recordInitialComment(7777);
		ss.clearInitialComment();
		expect(ss.getSessionState().initialCommentId).toBeNull();
	});

	it('deleteInitialComment() calls github client and clears comment id', async () => {
		vi.resetAllMocks();
		mockDeletePRComment.mockResolvedValue(undefined);
		ss.init({ agentType: 'implementation' });
		ss.recordInitialComment(55);
		await ss.deleteInitialComment('owner', 'repo');
		expect(mockDeletePRComment).toHaveBeenCalledWith('owner', 'repo', 55);
		expect(ss.getSessionState().initialCommentId).toBeNull();
	});

	it('deleteInitialComment() restores id on error', async () => {
		vi.resetAllMocks();
		mockDeletePRComment.mockRejectedValue(new Error('fail'));
		ss.init({ agentType: 'implementation' });
		ss.recordInitialComment(55);
		await ss.deleteInitialComment('owner', 'repo');
		expect(ss.getSessionState().initialCommentId).toBe(55);
	});

	it('deleteInitialComment() does nothing when no comment id', async () => {
		vi.resetAllMocks();
		ss.init({ agentType: 'implementation' });
		await ss.deleteInitialComment('owner', 'repo');
		expect(mockDeletePRComment).not.toHaveBeenCalled();
	});

	it('getSessionState() returns a copy, not a reference', () => {
		ss.init({ agentType: 'implementation' });
		const s1 = ss.getSessionState();
		const s2 = ss.getSessionState();
		expect(s1).not.toBe(s2);
		expect(s1).toEqual(s2);
	});

	it('mutations to returned state do not affect internal state', () => {
		ss.init({ agentType: 'implementation' });
		const state = ss.getSessionState();
		(state as Record<string, unknown>).prCreated = true;
		expect(ss.getSessionState().prCreated).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// createSessionState() factory tests
// ---------------------------------------------------------------------------

describe('createSessionState()', () => {
	it('returns a new SessionState instance', () => {
		const a = createSessionState();
		const b = createSessionState();
		expect(a).toBeInstanceOf(SessionState);
		expect(b).toBeInstanceOf(SessionState);
		expect(a).not.toBe(b);
	});

	it('instances are isolated — mutations on one do not affect the other', () => {
		const a = createSessionState();
		const b = createSessionState();
		a.init({ agentType: 'implementation' });
		a.recordPRCreation('https://github.com/pr/1');
		b.init({ agentType: 'review' });
		expect(a.getSessionState().prCreated).toBe(true);
		expect(b.getSessionState().prCreated).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// setDefaultSessionState() / DI tests
// ---------------------------------------------------------------------------

describe('setDefaultSessionState()', () => {
	it('replaces the default instance used by module-level functions', () => {
		const custom = createSessionState();
		custom.init({ agentType: 'custom-agent', projectId: 'custom-proj' });

		setDefaultSessionState(custom);

		expect(getProjectId()).toBe('custom-proj');
		expect(getBaseBranch()).toBe('main');
	});

	it('module-level mutations affect the injected instance', () => {
		const custom = createSessionState();
		custom.init({ agentType: 'implementation' });
		setDefaultSessionState(custom);

		recordPRCreation('https://github.com/pr/99');

		expect(custom.getSessionState().prCreated).toBe(true);
		expect(custom.getSessionState().prUrl).toBe('https://github.com/pr/99');
	});

	it('restores isolation after resetting to fresh instance', () => {
		const first = createSessionState();
		first.init({ agentType: 'first', projectId: 'first-proj' });
		setDefaultSessionState(first);
		expect(getProjectId()).toBe('first-proj');

		const second = createSessionState();
		second.init({ agentType: 'second', projectId: 'second-proj' });
		setDefaultSessionState(second);
		expect(getProjectId()).toBe('second-proj');

		// first should be unchanged
		expect(first.getProjectId()).toBe('first-proj');
	});
});

// ---------------------------------------------------------------------------
// clearInitialComment module-level wrapper test
// ---------------------------------------------------------------------------

describe('clearInitialComment (module-level)', () => {
	beforeEach(() => {
		// Reset to a fresh default instance to avoid cross-test contamination
		setDefaultSessionState(createSessionState());
		initSessionState({ agentType: 'implementation' });
	});

	it('clears initialCommentId via module function', () => {
		recordInitialComment(888);
		expect(getSessionState().initialCommentId).toBe(888);
		clearInitialComment();
		expect(getSessionState().initialCommentId).toBeNull();
	});
});
