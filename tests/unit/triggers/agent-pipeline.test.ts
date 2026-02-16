import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all external dependencies
vi.mock('../../../src/agents/registry.js', () => ({
	runAgent: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/budget.js', () => ({
	checkBudgetExceeded: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/agent-result-handler.js', () => ({
	handleAgentResultArtifacts: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/debug-trigger.js', () => ({
	shouldTriggerDebug: vi.fn(),
}));

vi.mock('../../../src/triggers/shared/debug-runner.js', () => ({
	triggerDebugAnalysis: vi.fn(),
}));

vi.mock('../../../src/utils/index.js', () => ({
	setCardActive: vi.fn(),
	clearCardActive: vi.fn(),
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { runAgent } from '../../../src/agents/registry.js';
import { executeAgentPipeline } from '../../../src/triggers/shared/agent-pipeline.js';
import { handleAgentResultArtifacts } from '../../../src/triggers/shared/agent-result-handler.js';
import { checkBudgetExceeded } from '../../../src/triggers/shared/budget.js';
import { shouldTriggerDebug } from '../../../src/triggers/shared/debug-trigger.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../../../src/types/index.js';
import { clearCardActive, logger, setCardActive } from '../../../src/utils/index.js';

describe('executeAgentPipeline', () => {
	const baseProject: ProjectConfig = {
		id: 'test',
		name: 'Test',
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
			progressModel: 'openrouter:google/gemini-2.5-flash-lite',
			progressIntervalMinutes: 5,
		},
		projects: [baseProject],
	};

	const mockLifecycle = {
		handleBudgetExceeded: vi.fn(),
		prepareForAgent: vi.fn(),
		cleanupProcessing: vi.fn(),
		handleBudgetWarning: vi.fn(),
		handleSuccess: vi.fn(),
		handleFailure: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(checkBudgetExceeded).mockResolvedValue({
			exceeded: false,
			currentCost: 1,
			budget: 5,
			remaining: 4,
		});
		vi.mocked(shouldTriggerDebug).mockResolvedValue(null);
	});

	it('runs agent with budget check and lifecycle hooks', async () => {
		const agentResult: AgentResult = {
			success: true,
			output: 'Done',
			runId: 'run-123',
			cost: 0.5,
		};
		vi.mocked(runAgent).mockResolvedValue(agentResult);

		await executeAgentPipeline({
			agentType: 'implementation',
			agentInput: { foo: 'bar' },
			workItemId: 'card-123',
			project: baseProject,
			config: baseConfig,
			lifecycle: mockLifecycle,
		});

		expect(checkBudgetExceeded).toHaveBeenCalledWith('card-123', baseProject, baseConfig);
		expect(setCardActive).toHaveBeenCalledWith('card-123');
		expect(mockLifecycle.prepareForAgent).toHaveBeenCalledWith('card-123', 'implementation');
		expect(runAgent).toHaveBeenCalledWith('implementation', {
			foo: 'bar',
			remainingBudgetUsd: 4,
			project: baseProject,
			config: baseConfig,
		});
		expect(handleAgentResultArtifacts).toHaveBeenCalledWith(
			'card-123',
			'implementation',
			agentResult,
			baseProject,
		);
		expect(mockLifecycle.cleanupProcessing).toHaveBeenCalledWith('card-123');
		expect(mockLifecycle.handleSuccess).toHaveBeenCalledWith(
			'card-123',
			'implementation',
			undefined,
		);
		expect(clearCardActive).toHaveBeenCalledWith('card-123');
	});

	it('stops early when budget exceeded before agent runs', async () => {
		vi.mocked(checkBudgetExceeded).mockResolvedValue({
			exceeded: true,
			currentCost: 6,
			budget: 5,
			remaining: 0,
		});

		await executeAgentPipeline({
			agentType: 'implementation',
			agentInput: {},
			workItemId: 'card-123',
			project: baseProject,
			config: baseConfig,
			lifecycle: mockLifecycle,
		});

		expect(logger.warn).toHaveBeenCalled();
		expect(mockLifecycle.handleBudgetExceeded).toHaveBeenCalledWith('card-123', 6, 5);
		expect(runAgent).not.toHaveBeenCalled();
	});

	it('warns when budget exceeded after agent runs', async () => {
		vi.mocked(checkBudgetExceeded)
			.mockResolvedValueOnce({ exceeded: false, currentCost: 2, budget: 5, remaining: 3 })
			.mockResolvedValueOnce({ exceeded: true, currentCost: 5.5, budget: 5, remaining: 0 });

		const agentResult: AgentResult = { success: true, output: 'Done', cost: 3.5 };
		vi.mocked(runAgent).mockResolvedValue(agentResult);

		await executeAgentPipeline({
			agentType: 'implementation',
			agentInput: {},
			workItemId: 'card-123',
			project: baseProject,
			config: baseConfig,
			lifecycle: mockLifecycle,
		});

		expect(mockLifecycle.handleBudgetWarning).toHaveBeenCalledWith('card-123', 5.5, 5);
	});

	it('calls handleFailure when agent fails', async () => {
		const agentResult: AgentResult = {
			success: false,
			output: '',
			error: 'Agent error',
		};
		vi.mocked(runAgent).mockResolvedValue(agentResult);

		await executeAgentPipeline({
			agentType: 'implementation',
			agentInput: {},
			workItemId: 'card-123',
			project: baseProject,
			config: baseConfig,
			lifecycle: mockLifecycle,
		});

		expect(mockLifecycle.handleSuccess).not.toHaveBeenCalled();
		expect(mockLifecycle.handleFailure).toHaveBeenCalledWith('card-123', 'Agent error');
	});

	it('skips lifecycle hooks when prepareLifecycle=false and cleanupLifecycle=false', async () => {
		const agentResult: AgentResult = { success: true, output: 'Done' };
		vi.mocked(runAgent).mockResolvedValue(agentResult);

		await executeAgentPipeline({
			agentType: 'respond-to-pr-comment',
			agentInput: {},
			workItemId: 'card-123',
			project: baseProject,
			config: baseConfig,
			lifecycle: mockLifecycle,
			prepareLifecycle: false,
			cleanupLifecycle: false,
		});

		expect(mockLifecycle.prepareForAgent).not.toHaveBeenCalled();
		expect(mockLifecycle.cleanupProcessing).not.toHaveBeenCalled();
		expect(mockLifecycle.handleSuccess).toHaveBeenCalled();
	});

	it('calls onAgentFailure hook when agent fails', async () => {
		const agentResult: AgentResult = { success: false, output: '', error: 'Fail' };
		vi.mocked(runAgent).mockResolvedValue(agentResult);
		const onAgentFailure = vi.fn();

		await executeAgentPipeline({
			agentType: 'implementation',
			agentInput: {},
			workItemId: 'card-123',
			project: baseProject,
			config: baseConfig,
			lifecycle: mockLifecycle,
			onAgentFailure,
		});

		expect(onAgentFailure).toHaveBeenCalledWith(agentResult);
		expect(mockLifecycle.handleFailure).toHaveBeenCalled();
	});

	it('handles workItemId=undefined gracefully', async () => {
		const agentResult: AgentResult = { success: true, output: 'Done' };
		vi.mocked(runAgent).mockResolvedValue(agentResult);

		await executeAgentPipeline({
			agentType: 'implementation',
			agentInput: {},
			workItemId: undefined,
			project: baseProject,
			config: baseConfig,
			lifecycle: mockLifecycle,
		});

		expect(checkBudgetExceeded).not.toHaveBeenCalled();
		expect(setCardActive).not.toHaveBeenCalled();
		expect(runAgent).toHaveBeenCalledWith('implementation', {
			remainingBudgetUsd: undefined,
			project: baseProject,
			config: baseConfig,
		});
		expect(handleAgentResultArtifacts).not.toHaveBeenCalled();
		expect(clearCardActive).not.toHaveBeenCalled();
	});
});
