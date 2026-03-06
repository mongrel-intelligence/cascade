import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/github/client.js', () => ({
	githubClient: {
		deletePRComment: vi.fn(),
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

import { getSessionState } from '../../../../src/gadgets/sessionState.js';
import { githubClient } from '../../../../src/github/client.js';
import { deleteProgressCommentOnSuccess } from '../../../../src/triggers/github/ack-comments.js';
import type { TriggerResult } from '../../../../src/triggers/types.js';
import type { AgentResult } from '../../../../src/types/index.js';

const mockGithubClient = vi.mocked(githubClient);
const mockGetSessionState = vi.mocked(getSessionState);

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

function makeAgentResult(): AgentResult {
	return { success: true } as AgentResult;
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
});
