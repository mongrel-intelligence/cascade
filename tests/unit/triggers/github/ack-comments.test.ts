import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/github/client.js', () => ({
	githubClient: {
		deletePRComment: vi.fn(),
		updatePRComment: vi.fn(),
		createPRComment: vi.fn(),
	},
}));

vi.mock('../../../../src/gadgets/sessionState.js', () => ({
	getSessionState: vi.fn(),
}));

vi.mock('../../../../src/utils/repo.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../src/utils/repo.js')>();
	return {
		...actual,
		parseRepoFullName: vi.fn().mockReturnValue({ owner: 'acme', repo: 'myapp' }),
	};
});

vi.mock('../../../../src/utils/safeOperation.js', () => ({
	safeOperation: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../../../../src/triggers/shared/review-pm-poster.js', () => ({
	postReviewToPM: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../src/router/ackMessageGenerator.js', () => ({
	extractGitHubContext: vi.fn().mockReturnValue('PR: Fix the bug'),
	generateAckMessage: vi.fn().mockResolvedValue('🔧 On it — fixing that bug'),
}));

vi.mock('../../../../src/config/agentMessages.js', () => ({
	INITIAL_MESSAGES: {
		implementation: '**⚙️ Implementation agent** — Starting work...',
		review: '**🔍 Review agent** — Reviewing...',
	},
}));

import { lookupWorkItemForPR } from '../../../../src/db/repositories/prWorkItemsRepository.js';
import { getSessionState } from '../../../../src/gadgets/sessionState.js';
import { githubClient } from '../../../../src/github/client.js';
import {
	extractGitHubContext,
	generateAckMessage,
} from '../../../../src/router/ackMessageGenerator.js';
import {
	deleteProgressCommentOnSuccess,
	postAcknowledgmentComment,
	updateInitialCommentWithError,
} from '../../../../src/triggers/github/ack-comments.js';
import { postReviewToPM } from '../../../../src/triggers/shared/review-pm-poster.js';
import type { TriggerResult } from '../../../../src/triggers/types.js';
import type { AgentResult } from '../../../../src/types/index.js';
import { parseRepoFullName } from '../../../../src/utils/repo.js';

const mockGithubClient = vi.mocked(githubClient);
const mockGetSessionState = vi.mocked(getSessionState);
const mockParseRepoFullName = vi.mocked(parseRepoFullName);
const mockExtractGitHubContext = vi.mocked(extractGitHubContext);
const mockGenerateAckMessage = vi.mocked(generateAckMessage);
const mockPostReviewToPM = vi.mocked(postReviewToPM);
const mockLookupWorkItemForPR = vi.mocked(lookupWorkItemForPR);

function makeResult(
	overrides: Partial<TriggerResult & { agentInput: Record<string, unknown> }> = {},
): TriggerResult {
	return {
		agentType: 'review',
		prNumber: 42,
		agentInput: {
			repoFullName: 'acme/myapp',
		},
		...overrides,
	} as TriggerResult;
}

function makeAgentResult(overrides: Partial<AgentResult> = {}): AgentResult {
	return { success: true, output: '', ...overrides } as AgentResult;
}

describe('deleteProgressCommentOnSuccess', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('skips deletion for implementation agent', async () => {
		const result = makeResult({ agentType: 'implementation' });
		await deleteProgressCommentOnSuccess(result, makeAgentResult());
		expect(mockGithubClient.deletePRComment).not.toHaveBeenCalled();
	});

	it('skips when repoFullName is missing', async () => {
		const result = makeResult({ agentInput: {} } as Partial<TriggerResult>);
		await deleteProgressCommentOnSuccess(result, makeAgentResult());
		expect(mockGithubClient.deletePRComment).not.toHaveBeenCalled();
	});

	it('skips when prNumber is missing', async () => {
		const result = makeResult({ prNumber: undefined });
		await deleteProgressCommentOnSuccess(result, makeAgentResult());
		expect(mockGithubClient.deletePRComment).not.toHaveBeenCalled();
	});

	it('deletes comment using sessionState.initialCommentId when available', async () => {
		mockGetSessionState.mockReturnValue({
			initialCommentId: 101,
		} as ReturnType<typeof getSessionState>);

		const result = makeResult();
		await deleteProgressCommentOnSuccess(result, makeAgentResult());

		expect(mockGithubClient.deletePRComment).toHaveBeenCalledWith('acme', 'myapp', 101);
	});

	it('falls back to agentInput.ackCommentId when sessionState.initialCommentId is null', async () => {
		mockGetSessionState.mockReturnValue({
			initialCommentId: null,
		} as ReturnType<typeof getSessionState>);

		const result = makeResult({
			agentInput: {
				repoFullName: 'acme/myapp',
				ackCommentId: 202,
			},
		} as Partial<TriggerResult>);

		await deleteProgressCommentOnSuccess(result, makeAgentResult());

		expect(mockGithubClient.deletePRComment).toHaveBeenCalledWith('acme', 'myapp', 202);
	});

	it('prefers sessionState.initialCommentId over agentInput.ackCommentId', async () => {
		mockGetSessionState.mockReturnValue({
			initialCommentId: 101,
		} as ReturnType<typeof getSessionState>);

		const result = makeResult({
			agentInput: {
				repoFullName: 'acme/myapp',
				ackCommentId: 202,
			},
		} as Partial<TriggerResult>);

		await deleteProgressCommentOnSuccess(result, makeAgentResult());

		expect(mockGithubClient.deletePRComment).toHaveBeenCalledWith('acme', 'myapp', 101);
	});

	it('skips when both sessionState.initialCommentId and agentInput.ackCommentId are absent', async () => {
		mockGetSessionState.mockReturnValue({
			initialCommentId: null,
		} as ReturnType<typeof getSessionState>);

		const result = makeResult();
		await deleteProgressCommentOnSuccess(result, makeAgentResult());

		expect(mockGithubClient.deletePRComment).not.toHaveBeenCalled();
	});

	it('handles already-deleted comment gracefully (404 via safeOperation)', async () => {
		mockGetSessionState.mockReturnValue({
			initialCommentId: 101,
		} as ReturnType<typeof getSessionState>);

		// safeOperation is mocked to just call fn(), simulate 404 being swallowed
		const { safeOperation } = await import('../../../../src/utils/safeOperation.js');
		vi.mocked(safeOperation).mockResolvedValueOnce(undefined);

		const result = makeResult();
		// Should not throw
		await expect(
			deleteProgressCommentOnSuccess(result, makeAgentResult()),
		).resolves.toBeUndefined();
	});

	it('passes agentResult.progressCommentId to postReviewToPM', async () => {
		mockGetSessionState.mockReturnValue({
			initialCommentId: 101,
			reviewBody: 'Looks good',
			reviewEvent: 'APPROVE',
			reviewUrl: 'https://github.com/acme/myapp/pull/42#pullrequestreview-1',
		} as ReturnType<typeof getSessionState>);

		const result = makeResult({ workItemId: 'card-123' });
		const agentResult = makeAgentResult({ progressCommentId: 'pm-comment-abc' });
		await deleteProgressCommentOnSuccess(result, agentResult);

		expect(mockPostReviewToPM).toHaveBeenCalledWith(
			'card-123',
			expect.objectContaining({ reviewBody: 'Looks good' }),
			'pm-comment-abc',
		);
	});

	it('looks up work item from DB when result.workItemId is absent', async () => {
		mockGetSessionState.mockReturnValue({
			initialCommentId: 101,
			reviewBody: 'LGTM',
			reviewEvent: 'APPROVE',
			reviewUrl: 'https://github.com/acme/myapp/pull/42#pullrequestreview-2',
		} as ReturnType<typeof getSessionState>);
		mockLookupWorkItemForPR.mockResolvedValueOnce('card-from-db');

		const result = makeResult({
			agentInput: {
				repoFullName: 'acme/myapp',
				project: { id: 'proj-999' },
			},
		} as Partial<TriggerResult>);

		await deleteProgressCommentOnSuccess(result, makeAgentResult());

		expect(mockLookupWorkItemForPR).toHaveBeenCalledWith('proj-999', 42);
		expect(mockPostReviewToPM).toHaveBeenCalledWith(
			'card-from-db',
			expect.objectContaining({ reviewBody: 'LGTM' }),
			undefined,
		);
	});

	it('posts review using DB work item when result.workItemId is absent and DB returns one', async () => {
		mockGetSessionState.mockReturnValue({
			initialCommentId: 101,
			reviewBody: 'Nice work',
			reviewEvent: 'COMMENT',
			reviewUrl: 'https://github.com/acme/myapp/pull/42#pullrequestreview-3',
		} as ReturnType<typeof getSessionState>);
		mockLookupWorkItemForPR.mockResolvedValueOnce('card-db-456');

		const result = makeResult({
			agentInput: {
				repoFullName: 'acme/myapp',
				project: { id: 'proj-1' },
			},
		} as Partial<TriggerResult>);
		const agentResult = makeAgentResult({ progressCommentId: 'pm-prog-xyz' });

		await deleteProgressCommentOnSuccess(result, agentResult);

		expect(mockPostReviewToPM).toHaveBeenCalledWith(
			'card-db-456',
			expect.objectContaining({ reviewBody: 'Nice work' }),
			'pm-prog-xyz',
		);
	});

	it('skips review posting when no work item found in result or DB', async () => {
		mockGetSessionState.mockReturnValue({
			initialCommentId: 101,
			reviewBody: 'Good PR',
			reviewEvent: 'APPROVE',
			reviewUrl: 'https://github.com/acme/myapp/pull/42#pullrequestreview-4',
		} as ReturnType<typeof getSessionState>);
		mockLookupWorkItemForPR.mockResolvedValueOnce(null);

		const result = makeResult({
			agentInput: {
				repoFullName: 'acme/myapp',
				project: { id: 'proj-1' },
			},
		} as Partial<TriggerResult>);

		await deleteProgressCommentOnSuccess(result, makeAgentResult());

		expect(mockPostReviewToPM).not.toHaveBeenCalled();
	});

	it('swallows DB lookup errors and skips review posting gracefully', async () => {
		mockGetSessionState.mockReturnValue({
			initialCommentId: 101,
			reviewBody: 'Looks good',
			reviewEvent: 'APPROVE',
			reviewUrl: 'https://github.com/acme/myapp/pull/42#pullrequestreview-5',
		} as ReturnType<typeof getSessionState>);
		mockLookupWorkItemForPR.mockRejectedValueOnce(new Error('DB connection failed'));

		const result = makeResult({
			agentInput: {
				repoFullName: 'acme/myapp',
				project: { id: 'proj-1' },
			},
		} as Partial<TriggerResult>);

		// Should not throw
		await expect(
			deleteProgressCommentOnSuccess(result, makeAgentResult()),
		).resolves.toBeUndefined();
		expect(mockPostReviewToPM).not.toHaveBeenCalled();
	});
});

describe('updateInitialCommentWithError', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockParseRepoFullName.mockReturnValue({ owner: 'acme', repo: 'myapp' });
	});

	it('skips when repoFullName is missing', async () => {
		const result = makeResult({ agentInput: {} } as Partial<TriggerResult>);
		await updateInitialCommentWithError(result, { success: false, error: 'Oops' });
		expect(mockGithubClient.updatePRComment).not.toHaveBeenCalled();
	});

	it('skips when prNumber is missing', async () => {
		const result = makeResult({ prNumber: undefined });
		await updateInitialCommentWithError(result, { success: false, error: 'Oops' });
		expect(mockGithubClient.updatePRComment).not.toHaveBeenCalled();
	});

	it('skips when initialCommentId is not set in sessionState', async () => {
		mockGetSessionState.mockReturnValue({
			initialCommentId: null,
		} as ReturnType<typeof getSessionState>);

		const result = makeResult();
		await updateInitialCommentWithError(result, { success: false, error: 'Oops' });
		expect(mockGithubClient.updatePRComment).not.toHaveBeenCalled();
	});

	it('updates PR comment with error body when all fields are present', async () => {
		mockGetSessionState.mockReturnValue({
			initialCommentId: 101,
		} as ReturnType<typeof getSessionState>);
		mockGithubClient.updatePRComment.mockResolvedValue(undefined as never);

		const result = makeResult();
		await updateInitialCommentWithError(result, { success: false, error: 'Something broke' });

		expect(mockGithubClient.updatePRComment).toHaveBeenCalledWith(
			'acme',
			'myapp',
			101,
			expect.stringContaining('Something broke'),
		);
	});

	it('includes agentType in the error body', async () => {
		mockGetSessionState.mockReturnValue({
			initialCommentId: 101,
		} as ReturnType<typeof getSessionState>);
		mockGithubClient.updatePRComment.mockResolvedValue(undefined as never);

		const result = makeResult({ agentType: 'review' });
		await updateInitialCommentWithError(result, { success: false, error: 'Agent error' });

		const callArgs = mockGithubClient.updatePRComment.mock.calls[0];
		expect(callArgs[3]).toContain('review agent failed');
	});

	it('uses default message when error is undefined', async () => {
		mockGetSessionState.mockReturnValue({
			initialCommentId: 101,
		} as ReturnType<typeof getSessionState>);
		mockGithubClient.updatePRComment.mockResolvedValue(undefined as never);

		const result = makeResult();
		await updateInitialCommentWithError(result, { success: false });

		const callArgs = mockGithubClient.updatePRComment.mock.calls[0];
		expect(callArgs[3]).toContain('Agent completed without making changes');
	});

	it('skips when parseRepoFullName throws', async () => {
		mockParseRepoFullName.mockImplementation(() => {
			throw new Error('Invalid repo name');
		});

		const result = makeResult();
		await updateInitialCommentWithError(result, { success: false, error: 'Oops' });
		expect(mockGithubClient.updatePRComment).not.toHaveBeenCalled();
	});
});

describe('postAcknowledgmentComment', () => {
	const fakeProject = { id: 'proj-1' } as import('../../../../src/types/index.js').ProjectConfig;

	beforeEach(() => {
		vi.clearAllMocks();
		mockParseRepoFullName.mockReturnValue({ owner: 'acme', repo: 'myapp' });
		mockExtractGitHubContext.mockReturnValue('PR: Fix the bug');
		mockGenerateAckMessage.mockResolvedValue('🔧 On it — fixing that bug');
		mockGithubClient.createPRComment.mockResolvedValue({ id: 999 } as never);
	});

	it('skips when agentType is missing', async () => {
		const result = makeResult({ agentType: null });
		await postAcknowledgmentComment(result, {}, 'issue_comment', fakeProject);
		expect(mockGithubClient.createPRComment).not.toHaveBeenCalled();
	});

	it('skips when prNumber is missing', async () => {
		const result = makeResult({ prNumber: undefined });
		await postAcknowledgmentComment(result, {}, 'issue_comment', fakeProject);
		expect(mockGithubClient.createPRComment).not.toHaveBeenCalled();
	});

	it('skips when repoFullName is missing', async () => {
		const result = makeResult({ agentInput: {} } as Partial<TriggerResult>);
		await postAcknowledgmentComment(result, {}, 'issue_comment', fakeProject);
		expect(mockGithubClient.createPRComment).not.toHaveBeenCalled();
	});

	it('posts acknowledgment comment and injects ackCommentId and ackMessage into agentInput', async () => {
		const result = makeResult();
		await postAcknowledgmentComment(
			result,
			{ pull_request: { title: 'Fix the bug' } },
			'pull_request',
			fakeProject,
		);

		expect(mockGithubClient.createPRComment).toHaveBeenCalledWith(
			'acme',
			'myapp',
			42,
			'🔧 On it — fixing that bug',
		);
		expect(result.agentInput.ackCommentId).toBe(999);
		expect(result.agentInput.ackMessage).toBe('🔧 On it — fixing that bug');
	});

	it('falls back to INITIAL_MESSAGES when generateAckMessage throws', async () => {
		mockGenerateAckMessage.mockRejectedValue(new Error('LLM failed'));

		const result = makeResult({ agentType: 'implementation' });
		await postAcknowledgmentComment(result, {}, 'issue_comment', fakeProject);

		expect(mockGithubClient.createPRComment).toHaveBeenCalledWith(
			'acme',
			'myapp',
			42,
			'**⚙️ Implementation agent** — Starting work...',
		);
		expect(result.agentInput.ackCommentId).toBe(999);
		expect(result.agentInput.ackMessage).toBe('**⚙️ Implementation agent** — Starting work...');
	});

	it('falls back to INITIAL_MESSAGES.implementation when generateAckMessage throws and no match', async () => {
		mockGenerateAckMessage.mockRejectedValue(new Error('LLM failed'));

		const result = makeResult({ agentType: 'unknown-agent' });
		await postAcknowledgmentComment(result, {}, 'issue_comment', fakeProject);

		// INITIAL_MESSAGES['unknown-agent'] is undefined so fallback is INITIAL_MESSAGES.implementation
		expect(mockGithubClient.createPRComment).toHaveBeenCalledWith(
			'acme',
			'myapp',
			42,
			'**⚙️ Implementation agent** — Starting work...',
		);
	});

	it('does not inject ackCommentId if createPRComment returns falsy', async () => {
		mockGithubClient.createPRComment.mockResolvedValue(undefined as never);

		const result = makeResult();
		await postAcknowledgmentComment(result, {}, 'issue_comment', fakeProject);

		expect(result.agentInput.ackCommentId).toBeUndefined();
		expect(result.agentInput.ackMessage).toBeUndefined();
	});
});
