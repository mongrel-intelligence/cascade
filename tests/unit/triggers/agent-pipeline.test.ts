import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all dependencies
vi.mock('../../../src/agents/registry.js', () => ({
	runAgent: vi.fn(),
}));

vi.mock('../../../src/pm/index.js', () => ({
	createPMProvider: vi.fn(() => ({ type: 'mock' })),
	resolveProjectPMConfig: vi.fn(() => ({ mock: 'config' })),
	PMLifecycleManager: vi.fn(),
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

import { runAgent } from '../../../src/agents/registry.js';
import { PMLifecycleManager } from '../../../src/pm/index.js';
import { executeAgentPipeline } from '../../../src/triggers/shared/agent-pipeline.js';
import { handleAgentResultArtifacts } from '../../../src/triggers/shared/agent-result-handler.js';
import { checkBudgetExceeded } from '../../../src/triggers/shared/budget.js';
import { triggerDebugAnalysis } from '../../../src/triggers/shared/debug-runner.js';
import { shouldTriggerDebug } from '../../../src/triggers/shared/debug-trigger.js';
import type { CascadeConfig, ProjectConfig } from '../../../src/types/index.js';

const mockLifecycle = {
	prepareForAgent: vi.fn(),
	cleanupProcessing: vi.fn(),
	handleBudgetExceeded: vi.fn(),
	handleBudgetWarning: vi.fn(),
	handleSuccess: vi.fn(),
	handleFailure: vi.fn(),
};

vi.mocked(PMLifecycleManager).mockImplementation(
	() => mockLifecycle as unknown as PMLifecycleManager,
);

const baseProject: ProjectConfig = {
	id: 'test-project',
	name: 'Test',
	repo: 'owner/repo',
	baseBranch: 'main',
	branchPrefix: 'feature/',
	trello: { boardId: 'board123', lists: {}, labels: {} },
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

	it('runs agent successfully with all lifecycle hooks', async () => {
		vi.mocked(checkBudgetExceeded).mockResolvedValue({
			exceeded: false,
			currentCost: 1,
			budget: 5,
			remaining: 4,
		});
		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: 'Agent completed',
			runId: 'run-123',
			cost: 0.5,
		});
		vi.mocked(shouldTriggerDebug).mockResolvedValue(null);

		await executeAgentPipeline({
			result: {
				agentType: 'implementation',
				agentInput: { cardId: 'card-123' },
				cardId: 'card-123',
			},
			project: baseProject,
			config: baseConfig,
		});

		expect(checkBudgetExceeded).toHaveBeenCalledWith('card-123', baseProject, baseConfig);
		expect(mockLifecycle.prepareForAgent).toHaveBeenCalledWith('card-123', 'implementation');
		expect(runAgent).toHaveBeenCalledWith('implementation', {
			cardId: 'card-123',
			remainingBudgetUsd: 4,
			project: baseProject,
			config: baseConfig,
		});
		expect(handleAgentResultArtifacts).toHaveBeenCalledWith(
			'card-123',
			'implementation',
			expect.objectContaining({ success: true }),
			baseProject,
		);
		expect(mockLifecycle.cleanupProcessing).toHaveBeenCalledWith('card-123');
		expect(mockLifecycle.handleSuccess).toHaveBeenCalledWith(
			'card-123',
			'implementation',
			undefined,
		);
	});

	it('aborts when budget exceeded before agent run', async () => {
		vi.mocked(checkBudgetExceeded).mockResolvedValue({
			exceeded: true,
			currentCost: 6,
			budget: 5,
			remaining: 0,
		});

		await executeAgentPipeline({
			result: {
				agentType: 'implementation',
				agentInput: {},
				cardId: 'card-123',
			},
			project: baseProject,
			config: baseConfig,
		});

		expect(mockLifecycle.handleBudgetExceeded).toHaveBeenCalledWith('card-123', 6, 5);
		expect(runAgent).not.toHaveBeenCalled();
	});

	it('handles agent failure', async () => {
		vi.mocked(checkBudgetExceeded).mockResolvedValue({
			exceeded: false,
			currentCost: 1,
			budget: 5,
			remaining: 4,
		});
		vi.mocked(runAgent).mockResolvedValue({
			success: false,
			output: '',
			error: 'Agent failed',
			runId: 'run-456',
			cost: 0.3,
		});
		vi.mocked(shouldTriggerDebug).mockResolvedValue(null);

		await executeAgentPipeline({
			result: {
				agentType: 'implementation',
				agentInput: {},
				cardId: 'card-123',
			},
			project: baseProject,
			config: baseConfig,
		});

		expect(mockLifecycle.handleFailure).toHaveBeenCalledWith('card-123', 'Agent failed');
		expect(mockLifecycle.handleSuccess).not.toHaveBeenCalled();
	});

	it('triggers post-budget warning when budget exceeded after agent run', async () => {
		vi.mocked(checkBudgetExceeded)
			.mockResolvedValueOnce({
				exceeded: false,
				currentCost: 4.5,
				budget: 5,
				remaining: 0.5,
			})
			.mockResolvedValueOnce({
				exceeded: true,
				currentCost: 5.2,
				budget: 5,
				remaining: 0,
			});
		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: 'Done',
			runId: 'run-789',
			cost: 0.7,
		});
		vi.mocked(shouldTriggerDebug).mockResolvedValue(null);

		await executeAgentPipeline({
			result: {
				agentType: 'review',
				agentInput: {},
				cardId: 'card-123',
			},
			project: baseProject,
			config: baseConfig,
		});

		expect(mockLifecycle.handleBudgetWarning).toHaveBeenCalledWith('card-123', 5.2, 5);
	});

	it('skips prepareLifecycle when prepareLifecycle is false', async () => {
		vi.mocked(checkBudgetExceeded).mockResolvedValue({
			exceeded: false,
			currentCost: 0,
			budget: 5,
			remaining: 5,
		});
		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: '',
			runId: 'run-999',
		});
		vi.mocked(shouldTriggerDebug).mockResolvedValue(null);

		await executeAgentPipeline({
			result: {
				agentType: 'respond-to-review',
				agentInput: {},
				cardId: 'card-456',
			},
			project: baseProject,
			config: baseConfig,
			prepareLifecycle: false,
		});

		expect(mockLifecycle.prepareForAgent).not.toHaveBeenCalled();
	});

	it('skips cleanupLifecycle when cleanupLifecycle is false', async () => {
		vi.mocked(checkBudgetExceeded).mockResolvedValue({
			exceeded: false,
			currentCost: 0,
			budget: 5,
			remaining: 5,
		});
		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: '',
			runId: 'run-888',
		});
		vi.mocked(shouldTriggerDebug).mockResolvedValue(null);

		await executeAgentPipeline({
			result: {
				agentType: 'respond-to-pr-comment',
				agentInput: {},
				cardId: 'card-789',
			},
			project: baseProject,
			config: baseConfig,
			cleanupLifecycle: false,
		});

		expect(mockLifecycle.cleanupProcessing).not.toHaveBeenCalled();
	});

	it('calls onAgentSuccess callback instead of lifecycle.handleSuccess', async () => {
		const onAgentSuccess = vi.fn();
		vi.mocked(checkBudgetExceeded).mockResolvedValue({
			exceeded: false,
			currentCost: 0,
			budget: 5,
			remaining: 5,
		});
		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: '',
			runId: 'run-111',
			prUrl: 'https://github.com/owner/repo/pull/123',
		});
		vi.mocked(shouldTriggerDebug).mockResolvedValue(null);

		await executeAgentPipeline({
			result: {
				agentType: 'implementation',
				agentInput: {},
				cardId: 'card-999',
			},
			project: baseProject,
			config: baseConfig,
			onAgentSuccess,
		});

		expect(onAgentSuccess).toHaveBeenCalledWith(
			expect.objectContaining({ success: true, prUrl: 'https://github.com/owner/repo/pull/123' }),
		);
		expect(mockLifecycle.handleSuccess).not.toHaveBeenCalled();
	});

	it('calls onAgentFailure callback in addition to lifecycle.handleFailure', async () => {
		const onAgentFailure = vi.fn();
		vi.mocked(checkBudgetExceeded).mockResolvedValue({
			exceeded: false,
			currentCost: 0,
			budget: 5,
			remaining: 5,
		});
		vi.mocked(runAgent).mockResolvedValue({
			success: false,
			output: '',
			error: 'Test error',
			runId: 'run-222',
		});
		vi.mocked(shouldTriggerDebug).mockResolvedValue(null);

		await executeAgentPipeline({
			result: {
				agentType: 'review',
				agentInput: {},
				cardId: 'card-888',
			},
			project: baseProject,
			config: baseConfig,
			onAgentFailure,
		});

		expect(onAgentFailure).toHaveBeenCalledWith(
			expect.objectContaining({ success: false, error: 'Test error' }),
		);
		expect(mockLifecycle.handleFailure).toHaveBeenCalledWith('card-888', 'Test error');
	});

	it('triggers auto-debug when agent fails', async () => {
		vi.mocked(checkBudgetExceeded).mockResolvedValue({
			exceeded: false,
			currentCost: 0,
			budget: 5,
			remaining: 5,
		});
		vi.mocked(runAgent).mockResolvedValue({
			success: false,
			output: '',
			error: 'Agent timeout',
			runId: 'run-333',
		});
		vi.mocked(shouldTriggerDebug).mockResolvedValue({
			runId: 'run-333',
			agentType: 'implementation',
			cardId: 'card-777',
		});

		await executeAgentPipeline({
			result: {
				agentType: 'implementation',
				agentInput: {},
				cardId: 'card-777',
			},
			project: baseProject,
			config: baseConfig,
		});

		expect(shouldTriggerDebug).toHaveBeenCalledWith('run-333');
		expect(triggerDebugAnalysis).toHaveBeenCalledWith(
			'run-333',
			baseProject,
			baseConfig,
			'card-777',
		);
	});

	it('handles missing cardId gracefully', async () => {
		vi.mocked(runAgent).mockResolvedValue({
			success: true,
			output: '',
			runId: 'run-444',
		});
		vi.mocked(shouldTriggerDebug).mockResolvedValue(null);

		await executeAgentPipeline({
			result: {
				agentType: 'debug',
				agentInput: { logDir: '/tmp/logs' },
			},
			project: baseProject,
			config: baseConfig,
		});

		expect(checkBudgetExceeded).not.toHaveBeenCalled();
		expect(mockLifecycle.prepareForAgent).not.toHaveBeenCalled();
		expect(runAgent).toHaveBeenCalled();
		expect(handleAgentResultArtifacts).not.toHaveBeenCalled();
	});
});
