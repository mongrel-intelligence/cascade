import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockValidateIntegrations,
	mockFormatValidationErrors,
	mockCheckBudgetExceeded,
	mockHandleAgentResultArtifacts,
	mockLogger,
} = vi.hoisted(() => ({
	mockValidateIntegrations: vi.fn(),
	mockFormatValidationErrors: vi.fn(),
	mockCheckBudgetExceeded: vi.fn(),
	mockHandleAgentResultArtifacts: vi.fn(),
	mockLogger: {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../../src/triggers/shared/integration-validation.js', () => ({
	validateIntegrations: mockValidateIntegrations,
	formatValidationErrors: mockFormatValidationErrors,
}));

vi.mock('../../../../src/triggers/shared/budget.js', () => ({
	checkBudgetExceeded: mockCheckBudgetExceeded,
}));

vi.mock('../../../../src/triggers/shared/agent-result-handler.js', () => ({
	handleAgentResultArtifacts: mockHandleAgentResultArtifacts,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import type { PMLifecycleManager } from '../../../../src/pm/index.js';
import {
	checkPreRunBudget,
	prepareAgentExecutionLifecycle,
	runPostAgentExecutionLifecycle,
	validateAgentExecutionLifecycle,
} from '../../../../src/triggers/shared/agent-execution-lifecycle.js';
import type { AgentExecutionContext } from '../../../../src/triggers/shared/agent-execution-types.js';
import type { TriggerResult } from '../../../../src/triggers/types.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../../../../src/types/index.js';

const PROJECT = {
	id: 'project-1',
	pm: { type: 'trello' },
} as ProjectConfig;

const CONFIG = { projects: [PROJECT] } as CascadeConfig;

const RESULT: TriggerResult = {
	agentType: 'implementation',
	workItemId: 'card-1',
	agentInput: {},
};

function createLifecycle() {
	return {
		prepareForAgent: vi.fn().mockResolvedValue(undefined),
		handleSuccess: vi.fn().mockResolvedValue(undefined),
		handleFailure: vi.fn().mockResolvedValue(undefined),
		handleBudgetExceeded: vi.fn().mockResolvedValue(undefined),
		handleBudgetWarning: vi.fn().mockResolvedValue(undefined),
		cleanupProcessing: vi.fn().mockResolvedValue(undefined),
	} as unknown as PMLifecycleManager & Record<string, ReturnType<typeof vi.fn>>;
}

function createContext(
	lifecycle: PMLifecycleManager,
	overrides: Partial<AgentExecutionContext> = {},
): AgentExecutionContext {
	return {
		result: RESULT,
		project: PROJECT,
		config: CONFIG,
		executionConfig: {},
		agentType: 'implementation',
		logLabel: 'Agent',
		lifecycle,
		lifecycleHooks: {},
		workItemId: 'card-1',
		agentInput: {},
		...overrides,
	};
}

describe('agent execution lifecycle helper', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockValidateIntegrations.mockResolvedValue({ valid: true, errors: [] });
		mockFormatValidationErrors.mockReturnValue('validation error');
		mockCheckBudgetExceeded.mockResolvedValue(null);
		mockHandleAgentResultArtifacts.mockResolvedValue(undefined);
	});

	it('allows execution when integration validation succeeds', async () => {
		const lifecycle = createLifecycle();

		await expect(
			validateAgentExecutionLifecycle({
				result: RESULT,
				project: PROJECT,
				executionConfig: {},
				agentType: 'implementation',
				lifecycle,
			}),
		).resolves.toBe(true);

		expect(mockValidateIntegrations).toHaveBeenCalledWith('project-1', 'implementation', PROJECT);
		expect(lifecycle.handleFailure).not.toHaveBeenCalled();
	});

	it('formats, logs, notifies PM, and invokes onFailure when non-PM validation fails', async () => {
		const lifecycle = createLifecycle();
		const onFailure = vi.fn().mockResolvedValue(undefined);
		const validation = {
			valid: false,
			errors: [{ category: 'scm' as const, message: 'GitHub token missing' }],
		};
		mockValidateIntegrations.mockResolvedValueOnce(validation);

		await expect(
			validateAgentExecutionLifecycle({
				result: RESULT,
				project: PROJECT,
				executionConfig: { onFailure },
				agentType: 'implementation',
				lifecycle,
			}),
		).resolves.toBe(false);

		expect(mockFormatValidationErrors).toHaveBeenCalledWith(validation);
		expect(mockLogger.error).toHaveBeenCalledWith('Integration validation failed', {
			agentType: 'implementation',
			projectId: 'project-1',
			errors: validation.errors,
		});
		expect(lifecycle.handleFailure).toHaveBeenCalledWith('card-1', 'validation error');
		expect(onFailure).toHaveBeenCalledWith(RESULT, {
			success: false,
			output: '',
			error: 'validation error',
		});
	});

	it('does not notify PM when PM validation failed', async () => {
		const lifecycle = createLifecycle();
		mockValidateIntegrations.mockResolvedValueOnce({
			valid: false,
			errors: [{ category: 'pm' as const, message: 'Trello missing' }],
		});

		await validateAgentExecutionLifecycle({
			result: RESULT,
			project: PROJECT,
			executionConfig: {},
			agentType: 'implementation',
			lifecycle,
		});

		expect(lifecycle.handleFailure).not.toHaveBeenCalled();
	});

	it('handles pre-run budget exceedance and tells callers to abort', async () => {
		const lifecycle = createLifecycle();
		mockCheckBudgetExceeded.mockResolvedValueOnce({
			exceeded: true,
			currentCost: 6,
			budget: 5,
			remaining: 0,
		});

		const result = await checkPreRunBudget('card-1', PROJECT, lifecycle);

		expect(result).toEqual({ remainingBudgetUsd: undefined, abort: true });
		expect(lifecycle.handleBudgetExceeded).toHaveBeenCalledWith('card-1', 6, 5);
	});

	it('returns remaining budget when pre-run budget is not exceeded', async () => {
		const lifecycle = createLifecycle();
		mockCheckBudgetExceeded.mockResolvedValueOnce({
			exceeded: false,
			currentCost: 2,
			budget: 5,
			remaining: 3,
		});

		await expect(checkPreRunBudget('card-1', PROJECT, lifecycle)).resolves.toEqual({
			remainingBudgetUsd: 3,
			abort: false,
		});
		expect(lifecycle.handleBudgetExceeded).not.toHaveBeenCalled();
	});

	it('runs prepareForAgent unless skipPrepareForAgent is set', async () => {
		const lifecycle = createLifecycle();
		await prepareAgentExecutionLifecycle(createContext(lifecycle));
		await prepareAgentExecutionLifecycle(
			createContext(lifecycle, { executionConfig: { skipPrepareForAgent: true } }),
		);

		expect(lifecycle.prepareForAgent).toHaveBeenCalledTimes(1);
		expect(lifecycle.prepareForAgent).toHaveBeenCalledWith('card-1', {});
	});

	it('runs post-agent artifacts, budget warning, cleanup, and success in order', async () => {
		const lifecycle = createLifecycle();
		const agentResult: AgentResult = {
			success: true,
			output: '',
			prUrl: 'https://github.com/acme/myapp/pull/1',
			progressCommentId: 'progress-1',
		};
		mockCheckBudgetExceeded.mockResolvedValueOnce({
			exceeded: true,
			currentCost: 5.5,
			budget: 5,
			remaining: 0,
		});

		await runPostAgentExecutionLifecycle(
			'card-1',
			'implementation',
			agentResult,
			PROJECT,
			lifecycle,
			{},
			{},
		);

		expect(mockHandleAgentResultArtifacts).toHaveBeenCalledWith(
			'card-1',
			'implementation',
			agentResult,
			PROJECT,
		);
		expect(lifecycle.handleBudgetWarning).toHaveBeenCalledWith('card-1', 5.5, 5);
		expect(lifecycle.cleanupProcessing).toHaveBeenCalledWith('card-1');
		expect(lifecycle.handleSuccess).toHaveBeenCalledWith(
			'card-1',
			{},
			'https://github.com/acme/myapp/pull/1',
			'progress-1',
		);
		expect(mockHandleAgentResultArtifacts.mock.invocationCallOrder[0]).toBeLessThan(
			lifecycle.handleBudgetWarning.mock.invocationCallOrder[0],
		);
		expect(lifecycle.handleBudgetWarning.mock.invocationCallOrder[0]).toBeLessThan(
			lifecycle.cleanupProcessing.mock.invocationCallOrder[0],
		);
		expect(lifecycle.cleanupProcessing.mock.invocationCallOrder[0]).toBeLessThan(
			lifecycle.handleSuccess.mock.invocationCallOrder[0],
		);
	});

	it('preserves GitHub-style post-run skip options', async () => {
		const lifecycle = createLifecycle();

		await runPostAgentExecutionLifecycle(
			'card-1',
			'review',
			{ success: false, output: '', error: 'review failed' },
			PROJECT,
			lifecycle,
			{},
			{
				skipPrepareForAgent: true,
				skipHandleFailure: true,
				handleSuccessOnlyForAgentType: 'implementation',
			},
		);

		expect(lifecycle.cleanupProcessing).not.toHaveBeenCalled();
		expect(lifecycle.handleSuccess).not.toHaveBeenCalled();
		expect(lifecycle.handleFailure).not.toHaveBeenCalled();
	});
});
