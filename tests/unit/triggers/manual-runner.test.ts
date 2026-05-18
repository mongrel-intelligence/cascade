import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/agents/definitions/loader.js', () => ({
	isPMFocusedAgent: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	getRunById: vi.fn(),
}));

// Default: agent is enabled (has a config row)
vi.mock('../../../src/db/repositories/agentConfigsRepository.js', () => ({
	isAgentEnabledForProject: vi.fn().mockResolvedValue(true),
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

vi.mock('../../../src/triggers/shared/integration-validation.js', () => ({
	validateIntegrations: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
	formatValidationErrors: vi.fn().mockReturnValue(''),
}));

vi.mock('../../../src/utils/lifecycle.js', () => ({
	startWatchdog: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/agent-execution.js', () => ({
	runAgentExecutionPipeline: vi.fn().mockResolvedValue(undefined),
}));

import { isPMFocusedAgent } from '../../../src/agents/definitions/loader.js';
import { isAgentEnabledForProject } from '../../../src/db/repositories/agentConfigsRepository.js';
import { getRunById } from '../../../src/db/repositories/runsRepository.js';
import { withPMCredentials } from '../../../src/pm/context.js';
import { createPMProvider, withPMProvider } from '../../../src/pm/index.js';
import { runAgentExecutionPipeline } from '../../../src/triggers/shared/agent-execution.js';
import {
	clearTriggerTracking,
	isTriggerRunning,
	triggerManualRun,
	triggerRetryRun,
} from '../../../src/triggers/shared/manual-runner.js';
import type { CascadeConfig, ProjectConfig } from '../../../src/types/index.js';

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
		vi.clearAllMocks();
		vi.mocked(runAgentExecutionPipeline).mockResolvedValue(undefined);
		vi.mocked(isPMFocusedAgent).mockResolvedValue(false);
		clearTriggerTracking();
	});

	it('throws when agent is not enabled for the project', async () => {
		vi.mocked(isAgentEnabledForProject).mockResolvedValueOnce(false);

		await expect(
			triggerManualRun(
				{
					projectId: 'test-project',
					agentType: 'implementation',
					workItemId: 'card-1',
				},
				mockProject,
				mockConfig,
			),
		).rejects.toThrow('not enabled for project');
	});

	it('throws when trigger is already running for same project+agent+card', async () => {
		vi.mocked(runAgentExecutionPipeline).mockImplementation(() => new Promise(() => {}));

		const firstRun = triggerManualRun(
			{
				projectId: 'test-project',
				agentType: 'implementation',
				workItemId: 'card-1',
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
					workItemId: 'card-1',
				},
				mockProject,
				mockConfig,
			),
		).rejects.toThrow('Manual trigger already running');

		// Clean up: avoid unhandled promise (firstRun will never resolve, but that's fine for test)
		void firstRun;
	});

	it('runs through the shared agent execution pipeline with manual trigger input', async () => {
		await triggerManualRun(
			{
				projectId: 'test-project',
				agentType: 'plan-implement',
				workItemId: 'card-1',
				workItemUrl: 'https://linear.app/org/issue/TEAM-123/example',
				workItemTitle: 'Implement example',
				modelOverride: 'claude-3-5-sonnet-20241022',
			},
			mockProject,
			mockConfig,
		);

		expect(runAgentExecutionPipeline).toHaveBeenCalledWith(
			expect.objectContaining({
				agentType: 'plan-implement',
				workItemId: 'card-1',
				workItemUrl: 'https://linear.app/org/issue/TEAM-123/example',
				workItemTitle: 'Implement example',
				agentInput: expect.objectContaining({
					workItemId: 'card-1',
					workItemUrl: 'https://linear.app/org/issue/TEAM-123/example',
					workItemTitle: 'Implement example',
					modelOverride: 'claude-3-5-sonnet-20241022',
					triggerType: 'manual',
				}),
			}),
			mockProject,
			mockConfig,
		);
	});

	it('passes PR fields through the shared execution pipeline when provided', async () => {
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

		expect(runAgentExecutionPipeline).toHaveBeenCalledWith(
			expect.objectContaining({
				agentType: 'review',
				prNumber: 42,
				agentInput: expect.objectContaining({
					prNumber: 42,
					prBranch: 'feature/test',
					repoFullName: 'owner/repo',
					headSha: 'abc123',
					triggerType: 'manual',
				}),
			}),
			mockProject,
			mockConfig,
			{
				skipPrepareForAgent: true,
				skipHandleFailure: true,
				handleSuccessOnlyForAgentType: 'implementation',
				logLabel: 'GitHub manual agent',
			},
		);
	});

	it('keeps PM lifecycle defaults for PR-based manual runs owned by PM-focused agents', async () => {
		vi.mocked(isPMFocusedAgent).mockResolvedValueOnce(true);

		await triggerManualRun(
			{
				projectId: 'test-project',
				agentType: 'backlog-manager',
				workItemId: 'card-1',
				prNumber: 42,
			},
			mockProject,
			mockConfig,
		);

		expect(runAgentExecutionPipeline).toHaveBeenCalledWith(
			expect.objectContaining({
				agentType: 'backlog-manager',
				workItemId: 'card-1',
				prNumber: 42,
			}),
			mockProject,
			mockConfig,
		);
	});

	it('wraps runAgent with PM credential and provider context', async () => {
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
		const workItemId = 'card-complete';

		await triggerManualRun({ projectId, agentType, workItemId }, mockProject, mockConfig);

		// After awaiting triggerManualRun, trigger should already be complete
		const key = `${projectId}:${agentType}:${workItemId}:no-pr`;
		expect(isTriggerRunning(key)).toBe(false);
	});

	it('marks trigger as complete even when runAgent fails', async () => {
		const projectId = 'test-project';
		const agentType = 'implementation';
		const workItemId = 'card-fail';

		vi.mocked(runAgentExecutionPipeline).mockRejectedValue(new Error('Agent error'));

		await triggerManualRun({ projectId, agentType, workItemId }, mockProject, mockConfig);

		// After awaiting triggerManualRun (error caught internally), trigger should be complete
		const key = `${projectId}:${agentType}:${workItemId}:no-pr`;
		expect(isTriggerRunning(key)).toBe(false);
	});
});

describe('triggerRetryRun', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(runAgentExecutionPipeline).mockResolvedValue(undefined);
		vi.mocked(isPMFocusedAgent).mockResolvedValue(false);
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
			workItemId: 'card-1',
			prNumber: null,
			model: 'claude-sonnet-4-5-20250929',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		await triggerRetryRun('run-1', mockProject, mockConfig);

		expect(runAgentExecutionPipeline).toHaveBeenCalledWith(
			expect.objectContaining({
				agentType: 'implementation',
				workItemId: 'card-1',
				agentInput: expect.objectContaining({
					workItemId: 'card-1',
					modelOverride: 'claude-sonnet-4-5-20250929',
					triggerType: 'manual',
				}),
			}),
			mockProject,
			mockConfig,
		);
	});

	it('uses modelOverride param if provided, otherwise falls back to original run model', async () => {
		vi.mocked(getRunById).mockResolvedValue({
			id: 'run-1',
			agentType: 'review',
			projectId: 'test-project',
			workItemId: null,
			prNumber: 10,
			model: 'claude-sonnet-4-5-20250929',
		} as ReturnType<typeof getRunById> extends Promise<infer T> ? NonNullable<T> : never);

		await triggerRetryRun('run-1', mockProject, mockConfig, 'claude-3-5-sonnet-20241022');

		expect(runAgentExecutionPipeline).toHaveBeenCalledWith(
			expect.objectContaining({
				agentType: 'review',
				prNumber: 10,
				agentInput: expect.objectContaining({
					modelOverride: 'claude-3-5-sonnet-20241022',
				}),
			}),
			mockProject,
			mockConfig,
			{
				skipPrepareForAgent: true,
				skipHandleFailure: true,
				handleSuccessOnlyForAgentType: 'implementation',
				logLabel: 'GitHub manual agent',
			},
		);
	});
});
