import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/agents/registry.js', () => ({
	runAgent: vi.fn(),
}));

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	getRunById: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../src/pm/index.js', () => ({
	createPMProvider: vi.fn(() => ({ type: 'mock-pm' })),
	pmRegistry: { getOrNull: vi.fn(() => null) },
	withPMProvider: vi.fn((_provider: unknown, fn: () => unknown) => fn()),
}));

vi.mock('../../../src/pm/context.js', () => ({
	withPMCredentials: vi.fn(
		(
			_projectId: string,
			_pmType: string | undefined,
			_getIntegration: unknown,
			fn: () => unknown,
		) => fn(),
	),
}));

vi.mock('../../../src/email/integration.js', () => ({
	withEmailIntegration: vi.fn((_projectId: string, fn: () => unknown) => fn()),
}));

vi.mock('../../../src/email/context.js', () => ({
	getEmailProviderOrNull: vi.fn(),
}));

vi.mock('../../../src/db/repositories/settingsRepository.js', () => ({
	getIntegrationByProjectAndCategory: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/config/triggerConfig.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...(actual as object),
		parseEmailJokeTriggers: vi.fn().mockReturnValue({}),
	};
});

vi.mock('../../../src/triggers/shared/integration-validation.js', () => ({
	validateIntegrations: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
	formatValidationErrors: vi.fn().mockReturnValue(''),
}));

import { runAgent } from '../../../src/agents/registry.js';
import { parseEmailJokeTriggers } from '../../../src/config/triggerConfig.js';
import { getRunById } from '../../../src/db/repositories/runsRepository.js';
import { getIntegrationByProjectAndCategory } from '../../../src/db/repositories/settingsRepository.js';
import { getEmailProviderOrNull } from '../../../src/email/context.js';
import { withPMCredentials } from '../../../src/pm/context.js';
import { createPMProvider, withPMProvider } from '../../../src/pm/index.js';
import {
	clearTriggerTracking,
	isTriggerRunning,
	triggerManualRun,
	triggerRetryRun,
} from '../../../src/triggers/shared/manual-runner.js';
import type { CascadeConfig, ProjectConfig } from '../../../src/types/index.js';
import { logger } from '../../../src/utils/logging.js';

const mockProject: ProjectConfig = {
	id: 'test-project',
	name: 'Test',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	trello: {
		boardId: 'board-1',
		lists: { splitting: 'l1', planning: 'l2', todo: 'l3' },
		labels: {},
	},
} as unknown as ProjectConfig;

const mockConfig = {} as CascadeConfig;

describe('triggerManualRun', () => {
	beforeEach(() => {
		clearTriggerTracking();
	});

	it('throws when trigger is already running for same project+agent+card', async () => {
		vi.mocked(runAgent).mockImplementation(() => new Promise(() => {})); // Never resolves

		// Start first trigger (don't await — runAgent never resolves)
		const firstRun = triggerManualRun(
			{
				projectId: 'test-project',
				agentType: 'implementation',
				cardId: 'card-1',
			},
			mockProject,
			mockConfig,
		);

		// Wait for async validation to complete and trigger to be marked as running
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Try to trigger again — should throw duplicate check
		await expect(
			triggerManualRun(
				{
					projectId: 'test-project',
					agentType: 'implementation',
					cardId: 'card-1',
				},
				mockProject,
				mockConfig,
			),
		).rejects.toThrow('Manual trigger already running');

		// Clean up: avoid unhandled promise (firstRun will never resolve, but that's fine for test)
		void firstRun;
	});

	it('calls runAgent with correct input including triggerType: manual', async () => {
		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: 'Done',
			runId: 'run-1',
		});

		await triggerManualRun(
			{
				projectId: 'test-project',
				agentType: 'implementation',
				cardId: 'card-1',
				modelOverride: 'claude-3-5-sonnet-20241022',
			},
			mockProject,
			mockConfig,
		);

		expect(runAgent).toHaveBeenCalledWith(
			'implementation',
			expect.objectContaining({
				cardId: 'card-1',
				modelOverride: 'claude-3-5-sonnet-20241022',
				triggerType: 'manual',
				project: mockProject,
				config: mockConfig,
			}),
		);
	});

	it('calls runAgent with PR fields when provided', async () => {
		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: 'Done',
			runId: 'run-2',
		});

		await triggerManualRun(
			{
				projectId: 'test-project',
				agentType: 'review',
				prNumber: 42,
				prBranch: 'feature/test',
				repoFullName: 'owner/repo',
				headSha: 'abc123',
			},
			mockProject,
			mockConfig,
		);

		expect(runAgent).toHaveBeenCalledWith(
			'review',
			expect.objectContaining({
				prNumber: 42,
				prBranch: 'feature/test',
				repoFullName: 'owner/repo',
				headSha: 'abc123',
				triggerType: 'manual',
			}),
		);
	});

	it('wraps runAgent with PM credential and provider context', async () => {
		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: 'Done',
			runId: 'run-pm',
		});

		await triggerManualRun(
			{ projectId: 'test-project', agentType: 'review', prNumber: 42 },
			mockProject,
			mockConfig,
		);

		// createPMProvider called with the project
		expect(createPMProvider).toHaveBeenCalledWith(mockProject);

		// withPMCredentials called with project.id, pm type, registry lookup, and inner fn
		expect(withPMCredentials).toHaveBeenCalledWith(
			'test-project',
			undefined, // mockProject has no pm.type
			expect.any(Function),
			expect.any(Function),
		);

		// withPMProvider called with the created provider and inner fn
		expect(withPMProvider).toHaveBeenCalledWith({ type: 'mock-pm' }, expect.any(Function));
	});

	it('marks trigger as complete after runAgent finishes', async () => {
		const projectId = 'test-project';
		const agentType = 'implementation';
		const cardId = 'card-complete';

		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: 'Done',
			runId: 'run-complete',
		});

		await triggerManualRun({ projectId, agentType, cardId }, mockProject, mockConfig);

		// After awaiting triggerManualRun, trigger should already be complete
		const key = `${projectId}:${agentType}:${cardId}:no-pr`;
		expect(isTriggerRunning(key)).toBe(false);
	});

	it('marks trigger as complete even when runAgent fails', async () => {
		const projectId = 'test-project';
		const agentType = 'implementation';
		const cardId = 'card-fail';

		vi.mocked(runAgent).mockRejectedValue(new Error('Agent error'));

		await triggerManualRun({ projectId, agentType, cardId }, mockProject, mockConfig);

		// After awaiting triggerManualRun (error caught internally), trigger should be complete
		const key = `${projectId}:${agentType}:${cardId}:no-pr`;
		expect(isTriggerRunning(key)).toBe(false);
	});
});

describe('triggerRetryRun', () => {
	beforeEach(() => {
		clearTriggerTracking();
	});

	it('throws when run is not found', async () => {
		vi.mocked(getRunById).mockResolvedValue(null);

		await expect(triggerRetryRun('run-1', mockProject, mockConfig)).rejects.toThrow(
			'Run not found: run-1',
		);
	});

	it('throws when run has no projectId', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'implementation',
			projectId: null,
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		await expect(triggerRetryRun('run-1', mockProject, mockConfig)).rejects.toThrow(
			'Run run-1 has no associated project',
		);
	});

	it('extracts params from original run and calls triggerManualRun', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'implementation',
			projectId: 'test-project',
			cardId: 'card-1',
			prNumber: null,
			model: 'claude-sonnet-4-5-20250929',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: 'Retried',
			runId: 'run-2',
		});

		await triggerRetryRun('run-1', mockProject, mockConfig);

		expect(runAgent).toHaveBeenCalledWith(
			'implementation',
			expect.objectContaining({
				cardId: 'card-1',
				modelOverride: 'claude-sonnet-4-5-20250929',
				triggerType: 'manual',
			}),
		);
	});

	it('uses modelOverride param if provided, otherwise falls back to original run model', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'review',
			projectId: 'test-project',
			cardId: null,
			prNumber: 10,
			model: 'claude-sonnet-4-5-20250929',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: 'Retried',
			runId: 'run-3',
		});

		await triggerRetryRun('run-1', mockProject, mockConfig, 'claude-3-5-sonnet-20241022');

		expect(runAgent).toHaveBeenCalledWith(
			'review',
			expect.objectContaining({
				modelOverride: 'claude-3-5-sonnet-20241022',
			}),
		);
	});
});

describe('email-joke pre-check', () => {
	beforeEach(() => {
		clearTriggerTracking();
		vi.mocked(runAgent).mockResolvedValue({ success: true, output: 'Done', runId: 'run-joke' });
	});

	it('aborts and warns when no email provider is available', async () => {
		vi.mocked(getEmailProviderOrNull).mockReturnValue(null);

		await triggerManualRun(
			{ projectId: 'test-project', agentType: 'email-joke' },
			mockProject,
			mockConfig,
		);

		expect(runAgent).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledWith(
			'Email provider unavailable, skipping email-joke agent',
			expect.objectContaining({ projectId: 'test-project' }),
		);
	});

	it('skips agent when no matching emails are found', async () => {
		const mockProvider = { searchEmails: vi.fn().mockResolvedValue([]) };
		vi.mocked(getEmailProviderOrNull).mockReturnValue(mockProvider as never);

		await triggerManualRun(
			{ projectId: 'test-project', agentType: 'email-joke' },
			mockProject,
			mockConfig,
		);

		expect(runAgent).not.toHaveBeenCalled();
		expect(logger.info).toHaveBeenCalledWith(
			'No matching emails found, skipping email-joke agent',
			expect.any(Object),
		);
	});

	it('runs agent with preFoundEmails when emails are found', async () => {
		const emails = [
			{
				uid: 42,
				subject: 'Hello',
				from: 'sender@example.com',
				to: ['me@example.com'],
				date: new Date('2024-01-15'),
				snippet: 'Hello there',
			},
		];
		const mockProvider = { searchEmails: vi.fn().mockResolvedValue(emails) };
		vi.mocked(getEmailProviderOrNull).mockReturnValue(mockProvider as never);

		await triggerManualRun(
			{ projectId: 'test-project', agentType: 'email-joke' },
			mockProject,
			mockConfig,
		);

		expect(runAgent).toHaveBeenCalledWith(
			'email-joke',
			expect.objectContaining({ preFoundEmails: emails }),
		);
	});

	it('does not call getEmailProviderOrNull for non-email-joke agents', async () => {
		vi.mocked(runAgent).mockResolvedValue({ success: true, output: 'Done', runId: 'run-impl' });

		await triggerManualRun(
			{ projectId: 'test-project', agentType: 'implementation', cardId: 'card-1' },
			mockProject,
			mockConfig,
		);

		expect(getEmailProviderOrNull).not.toHaveBeenCalled();
	});

	it('passes senderEmail as criteria.from when set via integration triggers', async () => {
		const mockProvider = { searchEmails: vi.fn().mockResolvedValue([]) };
		vi.mocked(getEmailProviderOrNull).mockReturnValue(mockProvider as never);
		vi.mocked(getIntegrationByProjectAndCategory).mockResolvedValue({
			triggers: {},
		} as never);
		vi.mocked(parseEmailJokeTriggers).mockReturnValue({ senderEmail: 'boss@example.com' } as never);

		await triggerManualRun(
			{ projectId: 'test-project', agentType: 'email-joke' },
			mockProject,
			mockConfig,
		);

		expect(mockProvider.searchEmails).toHaveBeenCalledWith(
			'INBOX',
			expect.objectContaining({ from: 'boss@example.com' }),
			10,
		);
	});
});
