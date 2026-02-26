import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/agents/registry.js', () => ({
	runAgent: vi.fn(),
}));

vi.mock('../../../src/pm/index.js', () => ({
	PMLifecycleManager: vi.fn(),
	createPMProvider: vi.fn(),
	resolveProjectPMConfig: vi.fn(),
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

import { runAgent } from '../../../src/agents/registry.js';
import {
	PMLifecycleManager,
	createPMProvider,
	resolveProjectPMConfig,
} from '../../../src/pm/index.js';
import { runAgentExecutionPipeline } from '../../../src/triggers/shared/agent-execution.js';
import { handleAgentResultArtifacts } from '../../../src/triggers/shared/agent-result-handler.js';
import { checkBudgetExceeded } from '../../../src/triggers/shared/budget.js';
import { triggerDebugAnalysis } from '../../../src/triggers/shared/debug-runner.js';
import { shouldTriggerDebug } from '../../../src/triggers/shared/debug-trigger.js';
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
		it('uses cardId when present', async () => {
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
				cardId: 'card-123',
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
});
