import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/agents/registry.js', () => ({
	runAgent: vi.fn(),
}));

vi.mock('../../../src/pm/index.js', () => ({
	PMLifecycleManager: vi.fn(),
	createPMProvider: vi.fn(),
	resolveProjectPMConfig: vi.fn(),
	hasAutoLabel: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../src/triggers/shared/agent-result-handler.js', () => ({
	handleAgentResultArtifacts: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/budget.js', () => ({
	checkBudgetExceeded: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/debug-runner.js', () => ({
	triggerDebugAnalysis: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/debug-trigger.js', () => ({
	shouldTriggerDebug: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/integration-validation.js', () => ({
	validateIntegrations: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
	formatValidationErrors: vi.fn().mockReturnValue(''),
}));

vi.mock('../../../src/triggers/shared/trigger-check.js', () => ({
	checkTriggerEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../src/pm/context.js', () => ({
	getPMProvider: vi.fn(),
}));

vi.mock('../../../src/pm/config.js', () => ({
	getTrelloConfig: vi.fn(),
	getJiraConfig: vi.fn(),
}));

import { runAgent } from '../../../src/agents/registry.js';
import { getJiraConfig, getTrelloConfig } from '../../../src/pm/config.js';
import { getPMProvider } from '../../../src/pm/context.js';
import {
	PMLifecycleManager,
	createPMProvider,
	hasAutoLabel,
	resolveProjectPMConfig,
} from '../../../src/pm/index.js';
import { runAgentExecutionPipeline } from '../../../src/triggers/shared/agent-execution.js';
import { handleAgentResultArtifacts } from '../../../src/triggers/shared/agent-result-handler.js';
import { checkBudgetExceeded } from '../../../src/triggers/shared/budget.js';
import { triggerDebugAnalysis } from '../../../src/triggers/shared/debug-runner.js';
import { shouldTriggerDebug } from '../../../src/triggers/shared/debug-trigger.js';
import { checkTriggerEnabled } from '../../../src/triggers/shared/trigger-check.js';
import type { TriggerResult } from '../../../src/triggers/types.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../../../src/types/index.js';
import { createMockProject } from '../../helpers/factories.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockProject: ProjectConfig = createMockProject({
	id: 'test-project',
	name: 'Test Project',
	trello: {
		boardId: 'board123',
		lists: {},
		labels: {},
		customFields: { cost: 'cf-cost-123' },
	},
});

const mockConfig: CascadeConfig = {
	defaults: {
		model: 'test-model',
		agentModels: {},
		maxIterations: 50,
		agentIterations: {},
		watchdogTimeoutMs: 1800000,
		cardBudgetUsd: 5,
		agentBackend: 'llmist',
		progressModel: 'openrouter:google/gemini-2.5-flash-lite',
		progressIntervalMinutes: 5,
	},
	projects: [mockProject],
};

const mockTriggerResult: TriggerResult = {
	agentType: 'implementation',
	workItemId: 'card-123',
	agentInput: { someInput: 'value' },
};

const mockLifecycle = {
	prepareForAgent: vi.fn(),
	handleBudgetExceeded: vi.fn(),
	handleBudgetWarning: vi.fn(),
	cleanupProcessing: vi.fn(),
	handleSuccess: vi.fn(),
	handleFailure: vi.fn(),
	handleError: vi.fn(),
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.mocked(createPMProvider).mockReturnValue({} as ReturnType<typeof createPMProvider>);
	vi.mocked(resolveProjectPMConfig).mockReturnValue({ labels: {}, statuses: {} });
	vi.mocked(PMLifecycleManager).mockImplementation(() => mockLifecycle as never);
	vi.mocked(checkBudgetExceeded).mockResolvedValue(null);
	vi.mocked(handleAgentResultArtifacts).mockResolvedValue(undefined);
	vi.mocked(shouldTriggerDebug).mockResolvedValue(null);
	vi.mocked(triggerDebugAnalysis).mockResolvedValue(undefined);
	vi.mocked(runAgent).mockResolvedValue({
		success: true,
		runId: 'run-1',
		output: '',
	} as AgentResult);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runAgentExecutionPipeline', () => {
	describe('budget checking', () => {
		it('aborts when budget is exceeded', async () => {
			vi.mocked(checkBudgetExceeded).mockResolvedValue({
				exceeded: true,
				currentCost: 6,
				budget: 5,
				remaining: 0,
			});

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig);

			expect(mockLifecycle.handleBudgetExceeded).toHaveBeenCalledWith('card-123', 6, 5);
			expect(runAgent).not.toHaveBeenCalled();
		});

		it('passes remainingBudgetUsd to runAgent when under budget', async () => {
			vi.mocked(checkBudgetExceeded).mockResolvedValue({
				exceeded: false,
				currentCost: 2,
				budget: 5,
				remaining: 3,
			});

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig);

			expect(runAgent).toHaveBeenCalledWith(
				'implementation',
				expect.objectContaining({ remainingBudgetUsd: 3 }),
			);
		});

		it('runs agent without budget constraint when no cost field configured', async () => {
			vi.mocked(checkBudgetExceeded).mockResolvedValue(null);

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig);

			expect(runAgent).toHaveBeenCalledWith(
				'implementation',
				expect.objectContaining({ remainingBudgetUsd: undefined }),
			);
		});

		it('issues budget warning after agent run if budget now exceeded', async () => {
			vi.mocked(checkBudgetExceeded)
				.mockResolvedValueOnce({ exceeded: false, currentCost: 2, budget: 5, remaining: 3 })
				.mockResolvedValueOnce({ exceeded: true, currentCost: 5.5, budget: 5, remaining: 0 });

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig);

			expect(mockLifecycle.handleBudgetWarning).toHaveBeenCalledWith('card-123', 5.5, 5);
		});
	});

	describe('lifecycle management', () => {
		it('calls prepareForAgent by default', async () => {
			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig);

			expect(mockLifecycle.prepareForAgent).toHaveBeenCalledWith('card-123', 'implementation');
		});

		it('skips prepareForAgent when skipPrepareForAgent is true', async () => {
			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig, {
				skipPrepareForAgent: true,
			});

			expect(mockLifecycle.prepareForAgent).not.toHaveBeenCalled();
		});

		it('calls cleanupProcessing after agent when prepareForAgent was called', async () => {
			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig);

			expect(mockLifecycle.cleanupProcessing).toHaveBeenCalledWith('card-123');
		});

		it('skips cleanupProcessing when skipPrepareForAgent is true', async () => {
			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig, {
				skipPrepareForAgent: true,
			});

			expect(mockLifecycle.cleanupProcessing).not.toHaveBeenCalled();
		});

		it('calls handleSuccess on successful agent run', async () => {
			vi.mocked(runAgent).mockResolvedValue({
				success: true,
				prUrl: 'https://github.com/pr/1',
				runId: 'run-1',
				output: '',
			});

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig);

			expect(mockLifecycle.handleSuccess).toHaveBeenCalledWith(
				'card-123',
				'implementation',
				'https://github.com/pr/1',
				undefined,
			);
		});

		it('passes progressCommentId to handleSuccess when present in agentResult', async () => {
			vi.mocked(runAgent).mockResolvedValue({
				success: true,
				prUrl: 'https://github.com/pr/1',
				progressCommentId: 'comment-456',
				runId: 'run-1',
				output: '',
			});

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig);

			expect(mockLifecycle.handleSuccess).toHaveBeenCalledWith(
				'card-123',
				'implementation',
				'https://github.com/pr/1',
				'comment-456',
			);
		});

		it('calls handleFailure on failed agent run', async () => {
			vi.mocked(runAgent).mockResolvedValue({
				success: false,
				error: 'Something went wrong',
				runId: 'run-1',
				output: '',
			});

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig);

			expect(mockLifecycle.handleFailure).toHaveBeenCalledWith('card-123', 'Something went wrong');
		});

		it('skips handleFailure when skipHandleFailure is true', async () => {
			vi.mocked(runAgent).mockResolvedValue({
				success: false,
				error: 'Error',
				runId: 'run-1',
				output: '',
			});

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig, {
				skipHandleFailure: true,
			});

			expect(mockLifecycle.handleFailure).not.toHaveBeenCalled();
		});

		it('only calls handleSuccess for matching agentType when handleSuccessOnlyForAgentType is set', async () => {
			// With non-matching agent type, handleSuccess should not be called
			const reviewResult: TriggerResult = {
				...mockTriggerResult,
				agentType: 'review',
			};

			await runAgentExecutionPipeline(reviewResult, mockProject, mockConfig, {
				handleSuccessOnlyForAgentType: 'implementation',
			});

			expect(mockLifecycle.handleSuccess).not.toHaveBeenCalled();
		});

		it('calls handleSuccess for matching agentType when handleSuccessOnlyForAgentType is set', async () => {
			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig, {
				handleSuccessOnlyForAgentType: 'implementation',
			});

			expect(mockLifecycle.handleSuccess).toHaveBeenCalled();
		});

		it('skips all lifecycle calls when no workItemId', async () => {
			const resultNoId: TriggerResult = {
				agentType: 'review',
				agentInput: {},
			};

			await runAgentExecutionPipeline(resultNoId, mockProject, mockConfig);

			expect(mockLifecycle.prepareForAgent).not.toHaveBeenCalled();
			expect(mockLifecycle.handleSuccess).not.toHaveBeenCalled();
			expect(mockLifecycle.handleFailure).not.toHaveBeenCalled();
			expect(runAgent).toHaveBeenCalledWith('review', expect.any(Object));
		});
	});

	describe('workItemId resolution', () => {
		it('uses workItemId when present (via result.workItemId)', async () => {
			const result: TriggerResult = {
				agentType: 'implementation',
				workItemId: 'card-456',
				agentInput: {},
			};

			await runAgentExecutionPipeline(result, mockProject, mockConfig);

			expect(mockLifecycle.prepareForAgent).toHaveBeenCalledWith('card-456', 'implementation');
		});

		it('uses workItemId when present', async () => {
			const result: TriggerResult = {
				agentType: 'implementation',
				workItemId: 'issue-789',
				agentInput: {},
			};

			await runAgentExecutionPipeline(result, mockProject, mockConfig);

			expect(mockLifecycle.prepareForAgent).toHaveBeenCalledWith('issue-789', 'implementation');
		});
	});

	describe('artifact handling', () => {
		it('calls handleAgentResultArtifacts with correct arguments', async () => {
			const agentResult = {
				success: true,
				runId: 'run-1',
				output: '',
				cost: 1.5,
			};
			vi.mocked(runAgent).mockResolvedValue(agentResult);

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig);

			expect(handleAgentResultArtifacts).toHaveBeenCalledWith(
				'card-123',
				'implementation',
				agentResult,
				mockProject,
			);
		});
	});

	describe('auto-debug', () => {
		it('triggers debug analysis for failed runs', async () => {
			vi.mocked(runAgent).mockResolvedValue({
				success: false,
				error: 'Agent failed',
				runId: 'run-failed',
				output: '',
			});
			vi.mocked(shouldTriggerDebug).mockResolvedValue({
				runId: 'run-failed',
				agentType: 'implementation',
				workItemId: 'card-123',
			});

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig);

			expect(shouldTriggerDebug).toHaveBeenCalledWith('run-failed');
			expect(triggerDebugAnalysis).toHaveBeenCalledWith(
				'run-failed',
				mockProject,
				mockConfig,
				'card-123',
			);
		});

		it('does not trigger debug analysis when shouldTriggerDebug returns null', async () => {
			vi.mocked(shouldTriggerDebug).mockResolvedValue(null);

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig);

			expect(triggerDebugAnalysis).not.toHaveBeenCalled();
		});

		it('does not trigger debug analysis when runId is missing', async () => {
			vi.mocked(runAgent).mockResolvedValue({
				success: true,
				output: '',
			});

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig);

			expect(shouldTriggerDebug).not.toHaveBeenCalled();
		});
	});

	describe('onSuccess callback', () => {
		it('calls onSuccess when agent succeeds', async () => {
			const agentResult: AgentResult = {
				success: true,
				runId: 'run-1',
				output: '',
			};
			vi.mocked(runAgent).mockResolvedValue(agentResult);
			const onSuccess = vi.fn().mockResolvedValue(undefined);

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig, { onSuccess });

			expect(onSuccess).toHaveBeenCalledWith(mockTriggerResult, agentResult);
		});

		it('does not call onSuccess when agent fails', async () => {
			vi.mocked(runAgent).mockResolvedValue({
				success: false,
				error: 'Agent error',
				runId: 'run-1',
				output: '',
			});
			const onSuccess = vi.fn().mockResolvedValue(undefined);

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig, { onSuccess });

			expect(onSuccess).not.toHaveBeenCalled();
		});
	});

	describe('onFailure callback', () => {
		it('calls onFailure when agent fails', async () => {
			const agentResult: AgentResult = {
				success: false,
				error: 'Agent error',
				runId: 'run-1',
				output: '',
			};
			vi.mocked(runAgent).mockResolvedValue(agentResult);
			const onFailure = vi.fn().mockResolvedValue(undefined);

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig, { onFailure });

			expect(onFailure).toHaveBeenCalledWith(mockTriggerResult, agentResult);
		});

		it('does not call onFailure when agent succeeds', async () => {
			const onFailure = vi.fn().mockResolvedValue(undefined);

			await runAgentExecutionPipeline(mockTriggerResult, mockProject, mockConfig, { onFailure });

			expect(onFailure).not.toHaveBeenCalled();
		});
	});

	describe('splitting agent auto-label propagation', () => {
		const mockProvider = {
			type: 'trello' as const,
			getWorkItem: vi.fn(),
			listWorkItems: vi.fn(),
			addLabel: vi.fn(),
		};

		beforeEach(() => {
			vi.mocked(getPMProvider).mockReturnValue(mockProvider as never);
			vi.mocked(resolveProjectPMConfig).mockReturnValue({
				labels: { auto: 'auto-label-id' },
				statuses: {},
			});
			vi.mocked(getTrelloConfig).mockReturnValue({
				boardId: 'board123',
				lists: { backlog: 'backlog-list-id' },
				labels: {},
			});
			vi.mocked(getJiraConfig).mockReturnValue(undefined);
			vi.mocked(checkTriggerEnabled).mockResolvedValue(false); // Don't chain backlog-manager

			// Mock hasAutoLabel to check if labels contain auto label
			vi.mocked(hasAutoLabel).mockImplementation((labels, config) => {
				return labels?.some((l) => l.id === config.labels.auto || l.name === 'auto') ?? false;
			});
		});

		it('propagates auto label to unlabeled backlog items after successful splitting (Trello)', async () => {
			const splittingResult: TriggerResult = {
				agentType: 'splitting',
				workItemId: 'parent-card',
				agentInput: {},
			};

			mockProvider.getWorkItem.mockResolvedValue({
				id: 'parent-card',
				title: 'Parent',
				description: '',
				url: '',
				status: 'backlog-list-id',
				labels: [{ id: 'auto-label-id', name: 'auto' }],
			});

			mockProvider.listWorkItems.mockResolvedValue([
				{
					id: 'card-1',
					title: 'Item 1',
					description: '',
					url: '',
					labels: [],
				},
				{
					id: 'card-2',
					title: 'Item 2',
					description: '',
					url: '',
					labels: [{ id: 'auto-label-id', name: 'auto' }],
				},
				{
					id: 'card-3',
					title: 'Item 3',
					description: '',
					url: '',
					labels: [],
				},
			]);

			mockProvider.addLabel.mockResolvedValue(undefined);

			await runAgentExecutionPipeline(splittingResult, mockProject, mockConfig);

			expect(mockProvider.listWorkItems).toHaveBeenCalledWith('backlog-list-id');
			expect(mockProvider.addLabel).toHaveBeenCalledTimes(2);
			expect(mockProvider.addLabel).toHaveBeenCalledWith('card-1', 'auto-label-id');
			expect(mockProvider.addLabel).toHaveBeenCalledWith('card-3', 'auto-label-id');
		});

		it('propagates auto label for JIRA projects using server-side status filtering', async () => {
			const jiraProvider = {
				type: 'jira' as const,
				getWorkItem: vi.fn(),
				listWorkItems: vi.fn(),
				addLabel: vi.fn(),
			};

			vi.mocked(getPMProvider).mockReturnValue(jiraProvider as never);
			vi.mocked(getTrelloConfig).mockReturnValue(undefined);
			vi.mocked(getJiraConfig).mockReturnValue({
				projectKey: 'PROJ',
				baseUrl: 'https://jira.example.com',
				statuses: { backlog: 'Backlog' },
				labels: {},
			});

			const splittingResult: TriggerResult = {
				agentType: 'splitting',
				workItemId: 'PROJ-1',
				agentInput: {},
			};

			jiraProvider.getWorkItem.mockResolvedValue({
				id: 'PROJ-1',
				title: 'Parent',
				description: '',
				url: '',
				status: 'Backlog',
				labels: [{ id: 'auto', name: 'auto' }],
			});

			// Server-side filtering: only backlog items are returned
			jiraProvider.listWorkItems.mockResolvedValue([
				{ id: 'PROJ-2', title: 'Item 1', description: '', url: '', status: 'Backlog', labels: [] },
				{
					id: 'PROJ-4',
					title: 'Item 3',
					description: '',
					url: '',
					status: 'Backlog',
					labels: [{ id: 'auto', name: 'auto' }],
				},
			]);

			jiraProvider.addLabel.mockResolvedValue(undefined);

			await runAgentExecutionPipeline(splittingResult, mockProject, mockConfig);

			// Should use server-side status filtering via the filter parameter
			expect(jiraProvider.listWorkItems).toHaveBeenCalledWith('PROJ', { status: 'Backlog' });
			// Should only label PROJ-2 (no auto label yet); PROJ-4 already has auto label
			expect(jiraProvider.addLabel).toHaveBeenCalledTimes(1);
			expect(jiraProvider.addLabel).toHaveBeenCalledWith('PROJ-2', 'auto-label-id');
		});

		it('does not propagate auto label if parent does not have auto label', async () => {
			const splittingResult: TriggerResult = {
				agentType: 'splitting',
				workItemId: 'parent-card',
				agentInput: {},
			};

			mockProvider.getWorkItem.mockResolvedValue({
				id: 'parent-card',
				title: 'Parent',
				description: '',
				url: '',
				status: 'backlog-list-id',
				labels: [], // No auto label
			});

			await runAgentExecutionPipeline(splittingResult, mockProject, mockConfig);

			expect(mockProvider.listWorkItems).not.toHaveBeenCalled();
			expect(mockProvider.addLabel).not.toHaveBeenCalled();
		});

		it('chains to backlog-manager after splitting when trigger is enabled and backlog is non-empty', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValue(true); // Enable chaining

			const splittingResult: TriggerResult = {
				agentType: 'splitting',
				workItemId: 'parent-card',
				agentInput: {},
			};

			mockProvider.getWorkItem.mockResolvedValue({
				id: 'parent-card',
				title: 'Parent',
				description: '',
				url: '',
				status: 'backlog-list-id',
				labels: [{ id: 'auto-label-id', name: 'auto' }],
			});

			// Non-empty backlog — agent should chain to backlog-manager
			mockProvider.listWorkItems.mockResolvedValue([
				{ id: 'backlog-card-1', title: 'Item 1', description: '', url: '', labels: [] },
			]);

			await runAgentExecutionPipeline(splittingResult, mockProject, mockConfig);

			// Should run agent twice: once for splitting, once for backlog-manager
			expect(runAgent).toHaveBeenCalledTimes(2);
			expect(runAgent).toHaveBeenNthCalledWith(1, 'splitting', expect.any(Object));
			expect(runAgent).toHaveBeenNthCalledWith(2, 'backlog-manager', expect.any(Object));
		});

		it('skips backlog-manager chain when backlog is empty after splitting', async () => {
			vi.mocked(checkTriggerEnabled).mockResolvedValue(true); // Enable chaining

			const splittingResult: TriggerResult = {
				agentType: 'splitting',
				workItemId: 'parent-card',
				agentInput: {},
			};

			mockProvider.getWorkItem.mockResolvedValue({
				id: 'parent-card',
				title: 'Parent',
				description: '',
				url: '',
				status: 'backlog-list-id',
				labels: [{ id: 'auto-label-id', name: 'auto' }],
			});

			// Empty backlog — backlog-manager should be skipped
			mockProvider.listWorkItems.mockResolvedValue([]);

			await runAgentExecutionPipeline(splittingResult, mockProject, mockConfig);

			// Only splitting ran — backlog-manager skipped because backlog is empty
			expect(runAgent).toHaveBeenCalledTimes(1);
			expect(runAgent).toHaveBeenCalledWith('splitting', expect.any(Object));
		});

		it('skips propagation if backlog list/status is not configured', async () => {
			vi.mocked(getTrelloConfig).mockReturnValue({
				boardId: 'board123',
				lists: {}, // No backlog list
				labels: {},
			});

			const splittingResult: TriggerResult = {
				agentType: 'splitting',
				workItemId: 'parent-card',
				agentInput: {},
			};

			mockProvider.getWorkItem.mockResolvedValue({
				id: 'parent-card',
				title: 'Parent',
				description: '',
				url: '',
				labels: [{ id: 'auto-label-id', name: 'auto' }],
			});

			await runAgentExecutionPipeline(splittingResult, mockProject, mockConfig);

			expect(mockProvider.listWorkItems).not.toHaveBeenCalled();
		});
	});
});
