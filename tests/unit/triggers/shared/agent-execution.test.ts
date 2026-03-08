import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
	mockRunAgent,
	mockGetPMProvider,
	mockResolveProjectPMConfig,
	mockCreatePMProvider,
	mockHasAutoLabel,
	mockGetTrelloConfig,
	mockCheckTriggerEnabled,
	mockValidateIntegrations,
	mockCheckBudgetExceeded,
	mockHandleAgentResultArtifacts,
	mockShouldTriggerDebug,
	mockTriggerDebugAnalysis,
	mockLogger,
	MockPMLifecycleManager,
} = vi.hoisted(() => ({
	mockRunAgent: vi.fn(),
	mockGetPMProvider: vi.fn(),
	mockResolveProjectPMConfig: vi.fn(),
	mockCreatePMProvider: vi.fn(),
	mockHasAutoLabel: vi.fn(),
	mockGetTrelloConfig: vi.fn(),
	mockCheckTriggerEnabled: vi.fn(),
	mockValidateIntegrations: vi.fn(),
	mockCheckBudgetExceeded: vi.fn(),
	mockHandleAgentResultArtifacts: vi.fn(),
	mockShouldTriggerDebug: vi.fn(),
	mockTriggerDebugAnalysis: vi.fn(),
	mockLogger: {
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
	MockPMLifecycleManager: vi.fn().mockImplementation(() => ({
		prepareForAgent: vi.fn().mockResolvedValue(undefined),
		handleSuccess: vi.fn().mockResolvedValue(undefined),
		handleFailure: vi.fn().mockResolvedValue(undefined),
		handleBudgetExceeded: vi.fn().mockResolvedValue(undefined),
		handleBudgetWarning: vi.fn().mockResolvedValue(undefined),
		cleanupProcessing: vi.fn().mockResolvedValue(undefined),
	})),
}));

vi.mock('../../../../src/agents/registry.js', () => ({
	runAgent: mockRunAgent,
}));

vi.mock('../../../../src/pm/context.js', () => ({
	getPMProvider: mockGetPMProvider,
}));

vi.mock('../../../../src/pm/index.js', () => ({
	PMLifecycleManager: MockPMLifecycleManager,
	resolveProjectPMConfig: mockResolveProjectPMConfig,
	hasAutoLabel: mockHasAutoLabel,
	createPMProvider: mockCreatePMProvider,
}));

vi.mock('../../../../src/pm/config.js', () => ({
	getTrelloConfig: mockGetTrelloConfig,
	getJiraConfig: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../../../../src/triggers/shared/trigger-check.js', () => ({
	checkTriggerEnabled: mockCheckTriggerEnabled,
}));

vi.mock('../../../../src/triggers/shared/integration-validation.js', () => ({
	validateIntegrations: mockValidateIntegrations,
	formatValidationErrors: vi.fn().mockReturnValue('validation error'),
}));

vi.mock('../../../../src/triggers/shared/budget.js', () => ({
	checkBudgetExceeded: mockCheckBudgetExceeded,
}));

vi.mock('../../../../src/triggers/shared/agent-result-handler.js', () => ({
	handleAgentResultArtifacts: mockHandleAgentResultArtifacts,
}));

vi.mock('../../../../src/triggers/shared/debug-trigger.js', () => ({
	shouldTriggerDebug: mockShouldTriggerDebug,
}));

vi.mock('../../../../src/triggers/shared/debug-runner.js', () => ({
	triggerDebugAnalysis: mockTriggerDebugAnalysis,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import { runAgentExecutionPipeline } from '../../../../src/triggers/shared/agent-execution.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT = {
	id: 'project-1',
	pm: { type: 'trello' },
	trello: { lists: { backlog: 'backlog-list-id' } },
} as any;

const CONFIG = {} as any;

const PM_CONFIG = {
	type: 'trello',
	labels: { auto: 'label-auto-id', readyToProcess: 'label-rtp' },
} as any;

function mockProvider(overrides: Record<string, any> = {}) {
	return {
		type: 'trello' as const,
		getWorkItem: vi.fn().mockResolvedValue({
			id: 'parent-card',
			labels: [{ id: 'label-auto-id', name: 'auto' }],
		}),
		listWorkItems: vi.fn().mockResolvedValue([
			{ id: 'backlog-1', labels: [] },
			{ id: 'backlog-2', labels: [{ id: 'label-auto-id', name: 'auto' }] },
		]),
		addLabel: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Shared setup for splitting auto-chain tests
// ---------------------------------------------------------------------------

function setupSplittingDefaults(providerOverrides: Record<string, any> = {}) {
	const provider = mockProvider(providerOverrides);
	mockGetPMProvider.mockReturnValue(provider);
	mockCreatePMProvider.mockReturnValue(provider);
	mockResolveProjectPMConfig.mockReturnValue(PM_CONFIG);
	mockGetTrelloConfig.mockReturnValue({ lists: { backlog: 'backlog-list-id' } });
	mockValidateIntegrations.mockResolvedValue({ valid: true, errors: [] });
	mockCheckBudgetExceeded.mockResolvedValue(null);
	mockHandleAgentResultArtifacts.mockResolvedValue(undefined);
	mockShouldTriggerDebug.mockResolvedValue(null);
	// Return true only when the labels array contains the auto label
	mockHasAutoLabel.mockImplementation((labels: Array<{ id: string }>) =>
		labels.some((l) => l.id === 'label-auto-id'),
	);
	mockCheckTriggerEnabled.mockResolvedValue(true);

	// First call: splitting agent succeeds. Second call: backlog-manager succeeds.
	mockRunAgent
		.mockResolvedValueOnce({ success: true, output: '', runId: 'run-1' })
		.mockResolvedValueOnce({ success: true, output: '', runId: 'run-2' });

	return provider;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('propagateAutoLabelAfterSplitting (via runAgentExecutionPipeline)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('chains to backlog-manager when splitting succeeds with auto label and trigger enabled', async () => {
		const provider = setupSplittingDefaults();

		await runAgentExecutionPipeline(
			{ agentType: 'splitting', agentInput: {}, workItemId: 'parent-card' },
			PROJECT,
			CONFIG,
		);

		// Should have called runAgent twice: splitting + backlog-manager
		expect(mockRunAgent).toHaveBeenCalledTimes(2);
		expect(mockRunAgent).toHaveBeenNthCalledWith(
			1,
			'splitting',
			expect.objectContaining({ project: PROJECT }),
		);
		expect(mockRunAgent).toHaveBeenNthCalledWith(
			2,
			'backlog-manager',
			expect.objectContaining({ project: PROJECT }),
		);

		// Should have propagated auto label to backlog items without it
		expect(provider.addLabel).toHaveBeenCalledWith('backlog-1', 'label-auto-id');
		// backlog-2 already has the label — should not be re-labeled
		expect(provider.addLabel).toHaveBeenCalledTimes(1);
	});

	it('does not chain when internal:auto-chain trigger is disabled', async () => {
		setupSplittingDefaults();
		mockCheckTriggerEnabled.mockResolvedValue(false);

		await runAgentExecutionPipeline(
			{ agentType: 'splitting', agentInput: {}, workItemId: 'parent-card' },
			PROJECT,
			CONFIG,
		);

		// Only splitting agent ran
		expect(mockRunAgent).toHaveBeenCalledTimes(1);
		expect(mockRunAgent).toHaveBeenCalledWith('splitting', expect.anything());

		// Trigger check was called with correct args
		expect(mockCheckTriggerEnabled).toHaveBeenCalledWith(
			'project-1',
			'backlog-manager',
			'internal:auto-chain',
			'splitting-auto-propagate',
		);

		// Should still propagate labels even when chaining is disabled
		expect(mockLogger.info).toHaveBeenCalledWith(
			'propagateAutoLabelAfterSplitting: backlog-manager trigger not enabled, skipping chain',
			expect.objectContaining({ workItemId: 'parent-card' }),
		);
	});

	it('does not chain when parent card does not have auto label', async () => {
		setupSplittingDefaults();
		mockHasAutoLabel.mockReturnValue(false);

		await runAgentExecutionPipeline(
			{ agentType: 'splitting', agentInput: {}, workItemId: 'parent-card' },
			PROJECT,
			CONFIG,
		);

		// Only splitting agent ran
		expect(mockRunAgent).toHaveBeenCalledTimes(1);

		// Should not have checked trigger or propagated labels
		expect(mockCheckTriggerEnabled).not.toHaveBeenCalled();
	});

	it('does not chain when splitting agent fails', async () => {
		setupSplittingDefaults();
		mockRunAgent.mockReset();
		mockRunAgent.mockResolvedValueOnce({ success: false, output: '', error: 'compile error' });

		await runAgentExecutionPipeline(
			{ agentType: 'splitting', agentInput: {}, workItemId: 'parent-card' },
			PROJECT,
			CONFIG,
		);

		// Only the failing splitting agent ran
		expect(mockRunAgent).toHaveBeenCalledTimes(1);

		// Should not attempt label propagation on failure
		expect(mockGetPMProvider).not.toHaveBeenCalled();
	});
});
