import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/agents/registry.js', () => ({
	runAgent: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/agent-result-handler.js', () => ({
	handleAgentResultArtifacts: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/budget.js', () => ({
	checkBudgetExceeded: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/debug-runner.js', () => ({
	triggerDebugAnalysis: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../src/triggers/shared/debug-trigger.js', () => ({
	shouldTriggerDebug: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
		info: vi.fn(),
		error: vi.fn(),
	},
}));

import { runAgent } from '../../../src/agents/registry.js';
import { executeAgentPipeline } from '../../../src/triggers/shared/agent-pipeline.js';
import { handleAgentResultArtifacts } from '../../../src/triggers/shared/agent-result-handler.js';
import { checkBudgetExceeded } from '../../../src/triggers/shared/budget.js';
import { triggerDebugAnalysis } from '../../../src/triggers/shared/debug-runner.js';
import { shouldTriggerDebug } from '../../../src/triggers/shared/debug-trigger.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../../../src/types/index.js';

const mockLifecycle = {
	prepareForAgent: vi.fn(),
	cleanupProcessing: vi.fn(),
	handleBudgetExceeded: vi.fn(),
	handleBudgetWarning: vi.fn(),
	handleSuccess: vi.fn(),
	handleFailure: vi.fn(),
	handleError: vi.fn(),
};

const baseProject: ProjectConfig = {
	id: 'test-project',
	name: 'Test Project',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	trello: {
		boardId: 'board123',
		lists: {},
		labels: {},
	},
};

const baseConfig: CascadeConfig = {
	defaults: {
		model: 'test-model',
		agentModels: {},
		maxIterations: 50,
		agentIterations: {},
		watchdogTimeoutMs: 1800000,
		cardBudgetUsd: 5,
		agentBackend: 'llmist',
		progressModel: 'test-progress-model',
		progressIntervalMinutes: 5,
	},
	projects: [baseProject],
};

describe('executeAgentPipeline', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('executes full pipeline with successful agent', async () => {
		const agentResult: AgentResult = {
			success: true,
			output: 'Agent completed',
			runId: 'run-123',
			prUrl: 'https://github.com/owner/repo/pull/1',
		};

		vi.mocked(checkBudgetExceeded).mockResolvedValue({
			exceeded: false,
			currentCost: 1.0,
			budget: 5.0,
			remaining: 4.0,
		});
		vi.mocked(runAgent).mockResolvedValue(agentResult);
		vi.mocked(shouldTriggerDebug).mockResolvedValue(null);

		const result = await executeAgentPipeline({
			agentType: 'implementation',
			agentInput: { foo: 'bar' },
			workItemId: 'card-1',
			project: baseProject,
			config: baseConfig,
			lifecycle: mockLifecycle as any,
		});

		expect(result).toBe(agentResult);
		expect(checkBudgetExceeded).toHaveBeenCalledWith('card-1', baseProject, baseConfig);
		expect(mockLifecycle.prepareForAgent).toHaveBeenCalledWith('card-1', 'implementation');
		expect(runAgent).toHaveBeenCalledWith('implementation', {
			foo: 'bar',
			remainingBudgetUsd: 4.0,
			project: baseProject,
			config: baseConfig,
		});
		expect(handleAgentResultArtifacts).toHaveBeenCalledWith(
			'card-1',
			'implementation',
			agentResult,
			baseProject,
		);
		expect(mockLifecycle.cleanupProcessing).toHaveBeenCalledWith('card-1');
		expect(mockLifecycle.handleSuccess).toHaveBeenCalledWith(
			'card-1',
			'implementation',
			'https://github.com/owner/repo/pull/1',
		);
	});

	it('skips lifecycle preparation when prepareLifecycle=false', async () => {
		const agentResult: AgentResult = { success: true, output: '', runId: 'run-123' };

		vi.mocked(checkBudgetExceeded).mockResolvedValue(null);
		vi.mocked(runAgent).mockResolvedValue(agentResult);
		vi.mocked(shouldTriggerDebug).mockResolvedValue(null);

		await executeAgentPipeline({
			agentType: 'respond-to-review',
			agentInput: {},
			workItemId: 'card-1',
			project: baseProject,
			config: baseConfig,
			lifecycle: mockLifecycle as any,
			prepareLifecycle: false,
		});

		expect(mockLifecycle.prepareForAgent).not.toHaveBeenCalled();
	});

	it('skips lifecycle cleanup when cleanupLifecycle=false', async () => {
		const agentResult: AgentResult = { success: true, output: '', runId: 'run-123' };

		vi.mocked(checkBudgetExceeded).mockResolvedValue(null);
		vi.mocked(runAgent).mockResolvedValue(agentResult);
		vi.mocked(shouldTriggerDebug).mockResolvedValue(null);

		await executeAgentPipeline({
			agentType: 'respond-to-review',
			agentInput: {},
			workItemId: 'card-1',
			project: baseProject,
			config: baseConfig,
			lifecycle: mockLifecycle as any,
			cleanupLifecycle: false,
		});

		expect(mockLifecycle.cleanupProcessing).not.toHaveBeenCalled();
	});

	it('calls onAgentFailure when agent fails', async () => {
		const agentResult: AgentResult = {
			success: false,
			output: '',
			error: 'Agent failed',
			runId: 'run-123',
		};
		const onAgentFailure = vi.fn();

		vi.mocked(checkBudgetExceeded).mockResolvedValue(null);
		vi.mocked(runAgent).mockResolvedValue(agentResult);
		vi.mocked(shouldTriggerDebug).mockResolvedValue(null);

		await executeAgentPipeline({
			agentType: 'implementation',
			agentInput: {},
			workItemId: 'card-1',
			project: baseProject,
			config: baseConfig,
			lifecycle: mockLifecycle as any,
			onAgentFailure,
		});

		expect(mockLifecycle.handleFailure).toHaveBeenCalledWith('card-1', 'Agent failed');
		expect(onAgentFailure).toHaveBeenCalledWith(agentResult);
	});

	it('aborts when pre-execution budget exceeded', async () => {
		vi.mocked(checkBudgetExceeded).mockResolvedValue({
			exceeded: true,
			currentCost: 6.0,
			budget: 5.0,
			remaining: 0,
		});

		const result = await executeAgentPipeline({
			agentType: 'implementation',
			agentInput: {},
			workItemId: 'card-1',
			project: baseProject,
			config: baseConfig,
			lifecycle: mockLifecycle as any,
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('Budget exceeded');
		expect(mockLifecycle.handleBudgetExceeded).toHaveBeenCalledWith('card-1', 6.0, 5.0);
		expect(runAgent).not.toHaveBeenCalled();
	});

	it('triggers budget warning when post-execution budget exceeded', async () => {
		const agentResult: AgentResult = { success: true, output: '', runId: 'run-123' };

		vi.mocked(checkBudgetExceeded)
			.mockResolvedValueOnce({ exceeded: false, currentCost: 3.0, budget: 5.0, remaining: 2.0 })
			.mockResolvedValueOnce({ exceeded: true, currentCost: 5.5, budget: 5.0, remaining: 0 });
		vi.mocked(runAgent).mockResolvedValue(agentResult);
		vi.mocked(shouldTriggerDebug).mockResolvedValue(null);

		await executeAgentPipeline({
			agentType: 'implementation',
			agentInput: {},
			workItemId: 'card-1',
			project: baseProject,
			config: baseConfig,
			lifecycle: mockLifecycle as any,
		});

		expect(mockLifecycle.handleBudgetWarning).toHaveBeenCalledWith('card-1', 5.5, 5.0);
	});

	it('triggers debug analysis when shouldTriggerDebug returns target', async () => {
		const agentResult: AgentResult = {
			success: false,
			output: '',
			error: 'Failed',
			runId: 'run-123',
		};

		vi.mocked(checkBudgetExceeded).mockResolvedValue(null);
		vi.mocked(runAgent).mockResolvedValue(agentResult);
		vi.mocked(shouldTriggerDebug).mockResolvedValue({
			runId: 'run-123',
			agentType: 'implementation',
			cardId: 'card-1',
		});

		await executeAgentPipeline({
			agentType: 'implementation',
			agentInput: {},
			workItemId: 'card-1',
			project: baseProject,
			config: baseConfig,
			lifecycle: mockLifecycle as any,
		});

		expect(triggerDebugAnalysis).toHaveBeenCalledWith('run-123', baseProject, baseConfig, 'card-1');
	});

	it('executes without workItemId', async () => {
		const agentResult: AgentResult = { success: true, output: '', runId: 'run-123' };

		vi.mocked(runAgent).mockResolvedValue(agentResult);
		vi.mocked(shouldTriggerDebug).mockResolvedValue(null);

		await executeAgentPipeline({
			agentType: 'review',
			agentInput: { prNumber: 42 },
			project: baseProject,
			config: baseConfig,
			lifecycle: mockLifecycle as any,
		});

		expect(checkBudgetExceeded).not.toHaveBeenCalled();
		expect(mockLifecycle.prepareForAgent).not.toHaveBeenCalled();
		expect(handleAgentResultArtifacts).not.toHaveBeenCalled();
		expect(runAgent).toHaveBeenCalledWith('review', {
			prNumber: 42,
			remainingBudgetUsd: undefined,
			project: baseProject,
			config: baseConfig,
		});
	});
});
