import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockCreateWorkItem,
	mockLinkPRToWorkItem,
	mockLookupWorkItemForPR,
	mockUpdateRunPRNumber,
	mockGithubClient,
	mockParseRepoFullName,
	mockLogger,
} = vi.hoisted(() => ({
	mockCreateWorkItem: vi.fn().mockResolvedValue(undefined),
	mockLinkPRToWorkItem: vi.fn().mockResolvedValue(undefined),
	mockLookupWorkItemForPR: vi.fn().mockResolvedValue(null),
	mockUpdateRunPRNumber: vi.fn().mockResolvedValue(undefined),
	mockGithubClient: {
		getPR: vi.fn().mockResolvedValue({ title: 'feat: linked PR' }),
	},
	mockParseRepoFullName: vi.fn().mockReturnValue({ owner: 'acme', repo: 'myapp' }),
	mockLogger: {
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	createWorkItem: mockCreateWorkItem,
	linkPRToWorkItem: mockLinkPRToWorkItem,
	lookupWorkItemForPR: mockLookupWorkItemForPR,
}));

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
	updateRunPRNumber: mockUpdateRunPRNumber,
}));

vi.mock('../../../../src/github/client.js', () => ({
	githubClient: mockGithubClient,
}));

vi.mock('../../../../src/utils/repo.js', () => ({
	parseRepoFullName: mockParseRepoFullName,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import {
	linkPRPostExecution,
	persistPreRunWorkItems,
	prepareAgentWorkItem,
	resolveWorkItemId,
} from '../../../../src/triggers/shared/agent-work-items.js';
import type { TriggerResult } from '../../../../src/triggers/types.js';
import type { ProjectConfig } from '../../../../src/types/index.js';

const PROJECT = {
	id: 'project-1',
	repo: 'acme/myapp',
	pm: { type: 'trello' },
} as unknown as ProjectConfig;

describe('agent-work-items', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateWorkItem.mockResolvedValue(undefined);
		mockLinkPRToWorkItem.mockResolvedValue(undefined);
		mockLookupWorkItemForPR.mockResolvedValue(null);
		mockUpdateRunPRNumber.mockResolvedValue(undefined);
		mockGithubClient.getPR.mockResolvedValue({ title: 'feat: linked PR' });
		mockParseRepoFullName.mockReturnValue({ owner: 'acme', repo: 'myapp' });
	});

	describe('resolveWorkItemId', () => {
		it('prefers the trigger-supplied workItemId', async () => {
			const result = await resolveWorkItemId('card-from-trigger', 'project-1', 42);

			expect(result).toBe('card-from-trigger');
			expect(mockLookupWorkItemForPR).not.toHaveBeenCalled();
		});

		it('falls back to PR lookup when no trigger workItemId is present', async () => {
			mockLookupWorkItemForPR.mockResolvedValueOnce('card-from-db');

			const result = await resolveWorkItemId(undefined, 'project-1', 42);

			expect(result).toBe('card-from-db');
			expect(mockLookupWorkItemForPR).toHaveBeenCalledWith('project-1', 42);
		});

		it('warns and returns undefined when PR lookup fails', async () => {
			mockLookupWorkItemForPR.mockRejectedValueOnce(new Error('db unavailable'));

			const result = await resolveWorkItemId(undefined, 'project-1', 42);

			expect(result).toBeUndefined();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				'Failed to resolve workItemId for PR',
				expect.objectContaining({ projectId: 'project-1', prNumber: 42 }),
			);
		});
	});

	describe('prepareAgentWorkItem', () => {
		it('patches agentInput.workItemId only when a work item is resolved', async () => {
			mockLookupWorkItemForPR.mockResolvedValueOnce('card-from-db');
			const result = await prepareAgentWorkItem(
				{
					agentType: 'review',
					agentInput: { prNumber: 42 },
					prNumber: 42,
				},
				'project-1',
			);

			expect(result).toEqual({
				workItemId: 'card-from-db',
				agentInput: { prNumber: 42, workItemId: 'card-from-db' },
			});
		});

		it('leaves agentInput untouched when no work item is resolved', async () => {
			const agentInput = { prNumber: 42 };
			const result = await prepareAgentWorkItem(
				{ agentType: 'review', agentInput, prNumber: 42 },
				'project-1',
			);

			expect(result.workItemId).toBeUndefined();
			expect(result.agentInput).toBe(agentInput);
		});
	});

	describe('persistPreRunWorkItems', () => {
		it('persists PM work-item display data and links the PR before the run', async () => {
			const result: TriggerResult = {
				agentType: 'review',
				agentInput: {},
				workItemId: 'card-1',
				workItemUrl: 'https://trello.com/c/card-1',
				workItemTitle: 'Build the thing',
				prNumber: 42,
				prUrl: 'https://github.com/acme/myapp/pull/42',
				prTitle: 'Test PR',
			};

			await persistPreRunWorkItems(result, PROJECT, 'card-1');

			expect(mockCreateWorkItem).toHaveBeenCalledWith('project-1', 'card-1', {
				workItemUrl: 'https://trello.com/c/card-1',
				workItemTitle: 'Build the thing',
			});
			expect(mockLinkPRToWorkItem).toHaveBeenCalledWith(
				'project-1',
				'acme/myapp',
				42,
				'card-1',
				expect.objectContaining({
					prUrl: 'https://github.com/acme/myapp/pull/42',
					prTitle: 'Test PR',
				}),
			);
		});

		it('creates an orphan PR link when no workItemId is resolved', async () => {
			await persistPreRunWorkItems(
				{
					agentType: 'review',
					agentInput: {},
					prNumber: 42,
					prUrl: 'https://github.com/acme/myapp/pull/42',
				},
				PROJECT,
				undefined,
			);

			expect(mockCreateWorkItem).not.toHaveBeenCalled();
			expect(mockLinkPRToWorkItem).toHaveBeenCalledWith(
				'project-1',
				'acme/myapp',
				42,
				null,
				expect.objectContaining({ prUrl: 'https://github.com/acme/myapp/pull/42' }),
			);
		});

		it('logs persistence and link failures without throwing', async () => {
			mockCreateWorkItem.mockRejectedValueOnce(new Error('create failed'));
			mockLinkPRToWorkItem.mockRejectedValueOnce(new Error('link failed'));

			await expect(
				persistPreRunWorkItems(
					{ agentType: 'review', agentInput: {}, prNumber: 42 },
					PROJECT,
					'card-1',
				),
			).resolves.toBeUndefined();

			expect(mockLogger.warn).toHaveBeenCalledWith(
				'Failed to persist work-item row for PM-triggered run',
				expect.objectContaining({ workItemId: 'card-1' }),
			);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				'Failed to ensure pr_work_items entry for PR-triggered run',
				expect.objectContaining({ prNumber: 42, workItemId: 'card-1' }),
			);
		});
	});

	describe('linkPRPostExecution', () => {
		const agentResult = {
			success: true,
			output: '',
			runId: 'run-1',
			prUrl: 'https://github.com/acme/myapp/pull/42',
		};

		it('fetches the PR title, links the PR, and backfills run prNumber', async () => {
			await linkPRPostExecution(
				agentResult,
				PROJECT as ProjectConfig & { repo: string },
				{
					agentType: 'implementation',
					agentInput: {},
					workItemUrl: 'https://trello.com/c/card-1',
					workItemTitle: 'Build the thing',
				},
				'card-1',
			);

			expect(mockGithubClient.getPR).toHaveBeenCalledWith('acme', 'myapp', 42);
			expect(mockLinkPRToWorkItem).toHaveBeenCalledWith(
				'project-1',
				'acme/myapp',
				42,
				'card-1',
				expect.objectContaining({
					prUrl: 'https://github.com/acme/myapp/pull/42',
					prTitle: 'feat: linked PR',
					workItemTitle: 'Build the thing',
				}),
			);
			expect(mockUpdateRunPRNumber).toHaveBeenCalledWith('run-1', 42);
		});

		it('continues when PR title fetch, link, and run backfill fail', async () => {
			mockGithubClient.getPR.mockRejectedValueOnce(new Error('github failed'));
			mockLinkPRToWorkItem.mockRejectedValueOnce(new Error('link failed'));
			mockUpdateRunPRNumber.mockRejectedValueOnce(new Error('run failed'));

			await expect(
				linkPRPostExecution(
					agentResult,
					PROJECT as ProjectConfig & { repo: string },
					{ agentType: 'implementation', agentInput: {} },
					'card-1',
				),
			).resolves.toBeUndefined();

			expect(mockLinkPRToWorkItem).toHaveBeenCalledWith(
				'project-1',
				'acme/myapp',
				42,
				'card-1',
				expect.objectContaining({ prTitle: undefined }),
			);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				'Failed to fetch PR title from GitHub',
				expect.objectContaining({ prNumber: 42 }),
			);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				'Failed to link PR to work item post-execution',
				expect.objectContaining({ prNumber: 42, workItemId: 'card-1' }),
			);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				'Failed to backfill prNumber on run',
				expect.objectContaining({ runId: 'run-1', prNumber: 42 }),
			);
		});
	});
});
