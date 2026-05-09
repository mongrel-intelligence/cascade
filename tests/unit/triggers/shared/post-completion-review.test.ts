import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentResult, ProjectConfig } from '../../../../src/types/index.js';

const { mockGithubClient, mockClaimReviewDispatch, mockBuildReviewDispatchKey, mockLogger } =
	vi.hoisted(() => ({
		mockGithubClient: {
			getPR: vi.fn(),
			getCheckSuiteStatus: vi.fn(),
		},
		mockClaimReviewDispatch: vi.fn(),
		mockBuildReviewDispatchKey: vi.fn(),
		mockLogger: {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
		},
	}));

vi.mock('../../../../src/github/client.js', () => ({
	githubClient: mockGithubClient,
}));

vi.mock('../../../../src/triggers/github/review-dispatch-dedup.js', () => ({
	buildReviewDispatchKey: (...args: unknown[]) => mockBuildReviewDispatchKey(...args),
	claimReviewDispatch: (...args: unknown[]) => mockClaimReviewDispatch(...args),
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import { buildPostCompletionReviewDispatch } from '../../../../src/triggers/shared/post-completion-review.js';

const PROJECT = {
	id: 'project-1',
	repo: 'acme/myapp',
	pm: { type: 'trello' },
} as ProjectConfig;

const SUCCESS_WITH_PR = {
	success: true,
	output: '',
	runId: 'run-1',
	prUrl: 'https://github.com/acme/myapp/pull/42',
} as AgentResult & { prUrl: string };

describe('buildPostCompletionReviewDispatch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGithubClient.getPR.mockResolvedValue({
			title: 'feat: test PR',
			headSha: 'sha-123',
			headRef: 'feature/test',
		});
		mockGithubClient.getCheckSuiteStatus.mockResolvedValue({ allPassing: true });
		mockBuildReviewDispatchKey.mockReturnValue('acme/myapp:42:sha-123');
		mockClaimReviewDispatch.mockResolvedValue(true);
	});

	it('returns review TriggerResult after implementation success with PR, head SHA, green CI, and dedup claim', async () => {
		const result = await buildPostCompletionReviewDispatch(SUCCESS_WITH_PR, PROJECT, 'card-1');

		expect(result).toEqual({
			agentType: 'review',
			agentInput: {
				prNumber: 42,
				prBranch: 'feature/test',
				repoFullName: 'acme/myapp',
				headSha: 'sha-123',
				triggerType: 'ci-success',
				triggerEvent: 'scm:check-suite-success',
				workItemId: 'card-1',
			},
			prNumber: 42,
			prUrl: 'https://github.com/acme/myapp/pull/42',
			prTitle: 'feat: test PR',
			workItemId: 'card-1',
		});
		expect(mockGithubClient.getPR).toHaveBeenCalledWith('acme', 'myapp', 42);
		expect(mockGithubClient.getCheckSuiteStatus).toHaveBeenCalledWith('acme', 'myapp', 'sha-123');
		expect(mockClaimReviewDispatch).toHaveBeenCalledWith(
			'acme/myapp:42:sha-123',
			'post-completion-hook',
			{
				prNumber: 42,
				headSha: 'sha-123',
			},
		);
	});

	it('returns null before GitHub lookup when required conditions are missing', async () => {
		await expect(
			buildPostCompletionReviewDispatch(
				{ success: false, output: '', error: 'failed', prUrl: SUCCESS_WITH_PR.prUrl },
				PROJECT,
				'card-1',
			),
		).resolves.toBeNull();
		await expect(
			buildPostCompletionReviewDispatch(
				{ success: true, output: '', runId: 'run-1' },
				PROJECT,
				'card-1',
			),
		).resolves.toBeNull();
		await expect(
			buildPostCompletionReviewDispatch(SUCCESS_WITH_PR, { ...PROJECT, repo: undefined }, 'card-1'),
		).resolves.toBeNull();

		expect(mockGithubClient.getPR).not.toHaveBeenCalled();
	});

	it('returns null when CI is not all passing', async () => {
		mockGithubClient.getCheckSuiteStatus.mockResolvedValueOnce({ allPassing: false });

		const result = await buildPostCompletionReviewDispatch(SUCCESS_WITH_PR, PROJECT, 'card-1');

		expect(result).toBeNull();
		expect(mockClaimReviewDispatch).not.toHaveBeenCalled();
		expect(mockLogger.debug).toHaveBeenCalledWith(
			'Skipping post-completion review: CI not all passing',
			expect.objectContaining({ prNumber: 42, workItemId: 'card-1' }),
		);
	});

	it('returns null when dedup claim fails', async () => {
		mockClaimReviewDispatch.mockResolvedValueOnce(false);

		const result = await buildPostCompletionReviewDispatch(SUCCESS_WITH_PR, PROJECT, 'card-1');

		expect(result).toBeNull();
		expect(mockLogger.info).toHaveBeenCalledWith(
			'Skipping post-completion review: already dispatched',
			expect.objectContaining({ dedupKey: 'acme/myapp:42:sha-123' }),
		);
	});

	it('logs and returns null on non-fatal lookup errors', async () => {
		mockGithubClient.getCheckSuiteStatus.mockRejectedValueOnce(new Error('GitHub down'));

		const result = await buildPostCompletionReviewDispatch(SUCCESS_WITH_PR, PROJECT, 'card-1');

		expect(result).toBeNull();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'Post-completion review dispatch failed (non-fatal)',
			expect.objectContaining({ error: 'Error: GitHub down' }),
		);
	});
});
