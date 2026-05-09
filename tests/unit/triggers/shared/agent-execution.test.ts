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
	mockPostAgentSummaryToPM,
	mockLookupWorkItemForPR,
	mockGithubClient,
	mockParseRepoFullName,
	mockGetAgentProfile,
	mockClaimReviewDispatch,
	mockBuildReviewDispatchKey,
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
	mockPostAgentSummaryToPM: vi.fn().mockResolvedValue(undefined),
	mockLookupWorkItemForPR: vi.fn().mockResolvedValue(null),
	mockGithubClient: {
		getPR: vi.fn().mockResolvedValue({ title: 'feat: test PR', headSha: 'abc123' }),
		getCheckSuiteStatus: vi.fn().mockResolvedValue({ allPassing: false }),
	},
	mockParseRepoFullName: vi.fn().mockReturnValue({ owner: 'acme', repo: 'myapp' }),
	mockGetAgentProfile: vi.fn().mockResolvedValue({ lifecycleHooks: {} }),
	mockClaimReviewDispatch: vi.fn().mockReturnValue(true),
	mockBuildReviewDispatchKey: vi.fn().mockReturnValue('acme/myapp:42:abc123'),
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

vi.mock('../../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	createWorkItem: vi.fn().mockResolvedValue(undefined),
	linkPRToWorkItem: vi.fn().mockResolvedValue(undefined),
	lookupWorkItemForPR: mockLookupWorkItemForPR,
}));

vi.mock('../../../../src/db/repositories/runsRepository.js', () => ({
	updateRunPRNumber: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/triggers/shared/agent-pm-summary.js', () => ({
	postAgentSummaryToPM: mockPostAgentSummaryToPM,
}));

vi.mock('../../../../src/github/client.js', () => ({
	githubClient: mockGithubClient,
}));

vi.mock('../../../../src/utils/repo.js', () => ({
	parseRepoFullName: mockParseRepoFullName,
}));

vi.mock('../../../../src/agents/definitions/profiles.js', () => ({
	getAgentProfile: mockGetAgentProfile,
}));

vi.mock('../../../../src/triggers/github/review-dispatch-dedup.js', () => ({
	claimReviewDispatch: (...args: unknown[]) => mockClaimReviewDispatch(...args),
	buildReviewDispatchKey: (...args: unknown[]) => mockBuildReviewDispatchKey(...args),
}));

import {
	createWorkItem,
	linkPRToWorkItem,
} from '../../../../src/db/repositories/prWorkItemsRepository.js';
import { runAgentExecutionPipeline } from '../../../../src/triggers/shared/agent-execution.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT = {
	id: 'project-1',
	repo: 'acme/myapp',
	pm: { type: 'trello' },
	trello: { lists: { backlog: 'backlog-list-id' } },
} as unknown as Parameters<typeof runAgentExecutionPipeline>[0]['project'];

const CONFIG = {} as unknown as Parameters<typeof runAgentExecutionPipeline>[0]['config'];

const PM_CONFIG = {
	type: 'trello',
	labels: { auto: 'label-auto-id', readyToProcess: 'label-rtp' },
} as unknown as ReturnType<typeof mockResolveProjectPMConfig>;

function mockProvider(overrides: Record<string, unknown> = {}) {
	return {
		type: 'trello' as const,
		getWorkItem: vi.fn().mockResolvedValue({
			id: 'parent-card',
			labels: [{ id: 'label-auto-id', name: 'auto' }],
		}),
		// Per-status impl: backlog has 2 cards, in-flight statuses are empty so the
		// chain's capacity check below the propagation block doesn't bail.
		listWorkItems: vi
			.fn()
			.mockImplementation(async (_containerId: string | undefined, opts?: { status?: string }) => {
				if (opts?.status === 'backlog') {
					return [
						{ id: 'backlog-1', labels: [] },
						{ id: 'backlog-2', labels: [{ id: 'label-auto-id', name: 'auto' }] },
					];
				}
				return [];
			}),
		addLabel: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Shared setup for splitting auto-chain tests
// ---------------------------------------------------------------------------

function setupSplittingDefaults(providerOverrides: Record<string, unknown> = {}) {
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

describe('runAgentExecutionPipeline facade characterization', () => {
	function setupPipelineDefaults() {
		vi.clearAllMocks();
		mockCreatePMProvider.mockReturnValue({});
		mockResolveProjectPMConfig.mockReturnValue(PM_CONFIG);
		mockValidateIntegrations.mockResolvedValue({ valid: true, errors: [] });
		mockCheckBudgetExceeded.mockResolvedValue(null);
		mockHandleAgentResultArtifacts.mockResolvedValue(undefined);
		mockShouldTriggerDebug.mockResolvedValue(null);
		mockRunAgent.mockResolvedValue({ success: true, output: '', runId: 'run-1' });
		mockGithubClient.getCheckSuiteStatus.mockResolvedValue({ allPassing: false });
	}

	function lifecycleInstance() {
		return MockPMLifecycleManager.mock.results[0]?.value as {
			prepareForAgent: ReturnType<typeof vi.fn>;
			handleSuccess: ReturnType<typeof vi.fn>;
			handleFailure: ReturnType<typeof vi.fn>;
			cleanupProcessing: ReturnType<typeof vi.fn>;
		};
	}

	beforeEach(() => {
		setupPipelineDefaults();
	});

	it('returns before constructing lifecycle or running the agent when agentType is missing', async () => {
		await runAgentExecutionPipeline(
			{ agentType: null, agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
		);

		expect(mockLogger.warn).toHaveBeenCalledWith(
			'No agent type in trigger result, skipping execution pipeline',
		);
		expect(mockCreatePMProvider).not.toHaveBeenCalled();
		expect(mockValidateIntegrations).not.toHaveBeenCalled();
		expect(mockRunAgent).not.toHaveBeenCalled();
	});

	it('notifies PM and invokes onFailure when integration validation fails after PM validation is usable', async () => {
		mockValidateIntegrations.mockResolvedValueOnce({
			valid: false,
			errors: [{ category: 'scm', message: 'GitHub token missing' }],
		});
		const onFailure = vi.fn().mockResolvedValue(undefined);

		await runAgentExecutionPipeline(
			{ agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
			{ onFailure },
		);

		const lifecycle = lifecycleInstance();
		expect(mockRunAgent).not.toHaveBeenCalled();
		expect(lifecycle.handleFailure).toHaveBeenCalledWith('card-1', 'validation error');
		expect(onFailure).toHaveBeenCalledWith(
			expect.objectContaining({ agentType: 'implementation', workItemId: 'card-1' }),
			{ success: false, output: '', error: 'validation error' },
		);
	});

	it('does not attempt PM failure notification when PM validation itself failed', async () => {
		mockValidateIntegrations.mockResolvedValueOnce({
			valid: false,
			errors: [{ category: 'pm', message: 'Trello missing' }],
		});
		const onFailure = vi.fn().mockResolvedValue(undefined);

		await runAgentExecutionPipeline(
			{ agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
			{ onFailure },
		);

		const lifecycle = lifecycleInstance();
		expect(mockRunAgent).not.toHaveBeenCalled();
		expect(lifecycle.handleFailure).not.toHaveBeenCalled();
		expect(onFailure).toHaveBeenCalledWith(
			expect.objectContaining({ agentType: 'implementation', workItemId: 'card-1' }),
			{ success: false, output: '', error: 'validation error' },
		);
	});

	it('continues to run the agent when work-item persistence fails before execution', async () => {
		vi.mocked(createWorkItem).mockRejectedValueOnce(new Error('db unavailable'));

		await runAgentExecutionPipeline(
			{ agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
		);

		expect(mockRunAgent).toHaveBeenCalledWith(
			'implementation',
			expect.objectContaining({ workItemId: 'card-1' }),
		);
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'Failed to persist work-item row for PM-triggered run',
			expect.objectContaining({ projectId: 'project-1', workItemId: 'card-1' }),
		);
	});

	it('orders onSuccess after agent execution and successful post-run lifecycle handling', async () => {
		const onSuccess = vi.fn().mockResolvedValue(undefined);

		await runAgentExecutionPipeline(
			{ agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
			{ onSuccess },
		);

		const lifecycle = lifecycleInstance();
		expect(mockRunAgent.mock.invocationCallOrder[0]).toBeLessThan(
			lifecycle.handleSuccess.mock.invocationCallOrder[0],
		);
		expect(lifecycle.handleSuccess.mock.invocationCallOrder[0]).toBeLessThan(
			onSuccess.mock.invocationCallOrder[0],
		);
	});

	it('orders onFailure after agent execution and failed post-run lifecycle handling', async () => {
		mockRunAgent.mockResolvedValueOnce({ success: false, output: '', error: 'agent failed' });
		const onFailure = vi.fn().mockResolvedValue(undefined);

		await runAgentExecutionPipeline(
			{ agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
			{ onFailure },
		);

		const lifecycle = lifecycleInstance();
		expect(mockRunAgent.mock.invocationCallOrder[0]).toBeLessThan(
			lifecycle.handleFailure.mock.invocationCallOrder[0],
		);
		expect(lifecycle.handleFailure.mock.invocationCallOrder[0]).toBeLessThan(
			onFailure.mock.invocationCallOrder[0],
		);
	});

	it('honors lifecycle skip flags without skipping the agent run', async () => {
		await runAgentExecutionPipeline(
			{ agentType: 'review', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
			{
				skipPrepareForAgent: true,
				skipHandleFailure: true,
				handleSuccessOnlyForAgentType: 'implementation',
			},
		);

		const lifecycle = lifecycleInstance();
		expect(mockRunAgent).toHaveBeenCalledWith('review', expect.anything());
		expect(lifecycle.prepareForAgent).not.toHaveBeenCalled();
		expect(lifecycle.cleanupProcessing).not.toHaveBeenCalled();
		expect(lifecycle.handleSuccess).not.toHaveBeenCalled();
		expect(lifecycle.handleFailure).not.toHaveBeenCalled();
	});
});

describe('propagateAutoLabelAfterSplitting (via runAgentExecutionPipeline)', () => {
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

	it('does not chain to backlog-manager when backlog is empty after splitting', async () => {
		// Override the provider to return no backlog items
		const provider = setupSplittingDefaults({
			listWorkItems: vi.fn().mockResolvedValue([]), // empty backlog
		});
		// Reset so we consume both queued return values cleanly (only splitting runs)
		mockRunAgent.mockReset();
		mockRunAgent.mockResolvedValueOnce({ success: true, output: '', runId: 'run-1' });

		await runAgentExecutionPipeline(
			{ agentType: 'splitting', agentInput: {}, workItemId: 'parent-card' },
			PROJECT,
			CONFIG,
		);

		// Only splitting agent ran — no backlog-manager chain
		expect(mockRunAgent).toHaveBeenCalledTimes(1);
		expect(mockRunAgent).toHaveBeenCalledWith('splitting', expect.anything());

		// No labels added since backlog is empty
		expect(provider.addLabel).not.toHaveBeenCalled();

		// Should log that backlog is empty
		expect(mockLogger.info).toHaveBeenCalledWith(
			'propagateAutoLabelAfterSplitting: backlog is empty after splitting, skipping backlog-manager chain',
			expect.objectContaining({ workItemId: 'parent-card' }),
		);

		// Should NOT have checked the trigger enabled state
		expect(mockCheckTriggerEnabled).not.toHaveBeenCalledWith(
			'project-1',
			'backlog-manager',
			'internal:auto-chain',
			'splitting-auto-propagate',
		);
	});

	it('uses the resolved UUID from parent labels when labels.auto is a name string', async () => {
		// Regression: Linear requires UUIDs for addLabel. When pmConfig.labels.auto is a
		// name string like 'cascade-auto', the UUID must be resolved from the parent work
		// item's label list to avoid a silent no-op in Linear's resolveLabelId().
		const provider = setupSplittingDefaults({
			getWorkItem: vi.fn().mockResolvedValue({
				id: 'parent-card',
				labels: [{ id: 'real-uuid-abc123', name: 'cascade-auto' }],
			}),
			listWorkItems: vi
				.fn()
				.mockImplementation(
					async (_containerId: string | undefined, opts?: { status?: string }) => {
						if (opts?.status === 'backlog') {
							return [{ id: 'backlog-item-1', labels: [] }];
						}
						return [];
					},
				),
		});
		// Simulate Linear config: labels.auto is a name string, not UUID
		mockResolveProjectPMConfig.mockReturnValue({
			...PM_CONFIG,
			labels: { ...PM_CONFIG.labels, auto: 'cascade-auto' },
		});
		// hasAutoLabel matches by name
		mockHasAutoLabel.mockImplementation((labels: Array<{ id: string; name: string }>) =>
			labels.some((l) => l.id === 'cascade-auto' || l.name === 'cascade-auto'),
		);

		await runAgentExecutionPipeline(
			{ agentType: 'splitting', agentInput: {}, workItemId: 'parent-card' },
			PROJECT,
			CONFIG,
		);

		// addLabel must be called with the resolved UUID, NOT the name string
		expect(provider.addLabel).toHaveBeenCalledWith('backlog-item-1', 'real-uuid-abc123');
		expect(provider.addLabel).not.toHaveBeenCalledWith('backlog-item-1', 'cascade-auto');

		// Note: the non-UUID warning is scoped to Linear only (project.pm.type === 'linear').
		// This test uses a Trello project, so no warning is emitted — Trello uses MongoDB Object
		// IDs which are valid non-UUID identifiers and should not produce log noise in happy paths.
	});

	it('skips propagation (returns null) when labels.auto is undefined even if hasAutoLabel mock returns true', async () => {
		// When labels.auto is undefined, the second guard in propagateAutoLabelAfterSplitting
		// short-circuits and returns null — no labeling, no chaining.
		const provider = setupSplittingDefaults();
		mockResolveProjectPMConfig.mockReturnValue({
			...PM_CONFIG,
			labels: { ...PM_CONFIG.labels, auto: undefined },
		});
		// Even if hasAutoLabel incorrectly returns true, the code checks autoLabelId next
		mockHasAutoLabel.mockReturnValue(true);
		mockRunAgent.mockReset();
		mockRunAgent.mockResolvedValueOnce({ success: true, output: '', runId: 'run-1' });

		await runAgentExecutionPipeline(
			{ agentType: 'splitting', agentInput: {}, workItemId: 'parent-card' },
			PROJECT,
			CONFIG,
		);

		// Only splitting ran — propagation skipped because autoLabelId is undefined
		expect(mockRunAgent).toHaveBeenCalledTimes(1);
		expect(provider.addLabel).not.toHaveBeenCalled();
	});

	it('passes UUID directly when labels.auto is already a valid UUID (happy path)', async () => {
		// When labels.auto IS a UUID, no resolution is needed and no warning is logged.
		// Use a proper UUID for this test (UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
		const UUID_LABEL = '00000000-0000-0000-0000-000000000001';
		// Pass getWorkItem override via setupSplittingDefaults so the mock is properly wired
		const provider = setupSplittingDefaults({
			getWorkItem: vi.fn().mockResolvedValue({
				id: 'parent-card',
				labels: [{ id: UUID_LABEL, name: 'auto' }],
			}),
		});
		mockResolveProjectPMConfig.mockReturnValue({
			...PM_CONFIG,
			labels: { ...PM_CONFIG.labels, auto: UUID_LABEL },
		});
		mockHasAutoLabel.mockImplementation((labels: Array<{ id: string }>) =>
			labels.some((l) => l.id === UUID_LABEL),
		);

		await runAgentExecutionPipeline(
			{ agentType: 'splitting', agentInput: {}, workItemId: 'parent-card' },
			PROJECT,
			CONFIG,
		);

		// addLabel called with UUID directly — no resolution warning should be logged
		expect(provider.addLabel).toHaveBeenCalledWith('backlog-1', UUID_LABEL);
		// No warning about non-UUID format since labels.auto is already a UUID
		expect(mockLogger.warn).not.toHaveBeenCalledWith(
			expect.stringContaining('labels.auto is not a UUID'),
			expect.anything(),
		);
	});
});

describe('agent PM summary facade delegation', () => {
	beforeEach(() => {
		mockCreatePMProvider.mockReturnValue({});
		mockResolveProjectPMConfig.mockReturnValue(PM_CONFIG);
		mockValidateIntegrations.mockResolvedValue({ valid: true, errors: [] });
		mockCheckBudgetExceeded.mockResolvedValue(null);
		mockHandleAgentResultArtifacts.mockResolvedValue(undefined);
		mockShouldTriggerDebug.mockResolvedValue(null);
	});

	it('delegates PM summary posting after the agent run', async () => {
		const agentResult = {
			success: true,
			output: 'Addressed all review comments.',
			runId: 'run-rr',
			progressCommentId: 'pm-prog-rr',
		};
		mockRunAgent.mockResolvedValueOnce(agentResult);

		await runAgentExecutionPipeline(
			{ agentType: 'respond-to-review', agentInput: {}, workItemId: 'card-3', prNumber: 42 },
			PROJECT,
			CONFIG,
		);

		expect(mockPostAgentSummaryToPM).toHaveBeenCalledWith(
			'respond-to-review',
			agentResult,
			'card-3',
			'project-1',
			42,
		);
	});
});

// ---------------------------------------------------------------------------
// linkPRPostExecution PR title backfill (via runAgentExecutionPipeline)
// ---------------------------------------------------------------------------

describe('linkPRPostExecution PR title backfill (via runAgentExecutionPipeline)', () => {
	beforeEach(() => {
		mockCreatePMProvider.mockReturnValue({});
		mockResolveProjectPMConfig.mockReturnValue(PM_CONFIG);
		mockValidateIntegrations.mockResolvedValue({ valid: true, errors: [] });
		mockCheckBudgetExceeded.mockResolvedValue(null);
		mockHandleAgentResultArtifacts.mockResolvedValue(undefined);
		mockShouldTriggerDebug.mockResolvedValue(null);
		mockParseRepoFullName.mockReturnValue({ owner: 'acme', repo: 'myapp' });
	});

	it('fetches PR title and passes to linkPRToWorkItem', async () => {
		mockGithubClient.getPR.mockResolvedValueOnce({ title: 'feat: add auth' });
		mockRunAgent.mockResolvedValueOnce({
			success: true,
			output: '',
			runId: 'run-1',
			prUrl: 'https://github.com/acme/myapp/pull/42',
		});

		await runAgentExecutionPipeline(
			{ agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
		);

		expect(mockGithubClient.getPR).toHaveBeenCalledWith('acme', 'myapp', 42);
		expect(vi.mocked(linkPRToWorkItem)).toHaveBeenCalledWith(
			'project-1',
			'acme/myapp',
			42,
			'card-1',
			expect.objectContaining({ prTitle: 'feat: add auth' }),
		);
	});

	it('handles GitHub API failure gracefully (still links without title)', async () => {
		mockGithubClient.getPR.mockRejectedValueOnce(new Error('GitHub 500'));
		mockRunAgent.mockResolvedValueOnce({
			success: true,
			output: '',
			runId: 'run-1',
			prUrl: 'https://github.com/acme/myapp/pull/42',
		});

		await runAgentExecutionPipeline(
			{ agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
		);

		expect(vi.mocked(linkPRToWorkItem)).toHaveBeenCalledWith(
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
	});
});

// ---------------------------------------------------------------------------
// Pre-execution PR linking (via runAgentExecutionPipeline)
// ---------------------------------------------------------------------------

describe('pre-execution PR linking (via runAgentExecutionPipeline)', () => {
	beforeEach(() => {
		mockCreatePMProvider.mockReturnValue({});
		mockResolveProjectPMConfig.mockReturnValue(PM_CONFIG);
		mockValidateIntegrations.mockResolvedValue({ valid: true, errors: [] });
		mockCheckBudgetExceeded.mockResolvedValue(null);
		mockHandleAgentResultArtifacts.mockResolvedValue(undefined);
		mockShouldTriggerDebug.mockResolvedValue(null);
		mockRunAgent.mockResolvedValue({ success: true, output: '', runId: 'run-1' });
	});

	it('calls linkPRToWorkItem before agent runs when result has prNumber', async () => {
		await runAgentExecutionPipeline(
			{
				agentType: 'review',
				agentInput: {},
				prNumber: 42,
				prUrl: 'https://github.com/acme/myapp/pull/42',
				prTitle: 'Test PR',
				workItemId: 'card-1',
			},
			PROJECT,
			CONFIG,
		);

		expect(vi.mocked(linkPRToWorkItem)).toHaveBeenCalledWith(
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

	it('creates orphan PR entry when prNumber is set but workItemId is undefined', async () => {
		await runAgentExecutionPipeline(
			{
				agentType: 'review',
				agentInput: {},
				prNumber: 42,
				prUrl: 'https://github.com/acme/myapp/pull/42',
				prTitle: 'Test PR',
			},
			PROJECT,
			CONFIG,
		);

		expect(vi.mocked(linkPRToWorkItem)).toHaveBeenCalledWith(
			'project-1',
			'acme/myapp',
			42,
			null,
			expect.objectContaining({
				prUrl: 'https://github.com/acme/myapp/pull/42',
				prTitle: 'Test PR',
			}),
		);
	});

	it('skips pre-execution linkPRToWorkItem when no prNumber', async () => {
		await runAgentExecutionPipeline(
			{ agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
		);

		// linkPRToWorkItem should not have been called pre-execution
		// (it may be called post-execution if the agent produces a prUrl, but
		// our mock agent returns no prUrl so it won't be called at all)
		expect(vi.mocked(linkPRToWorkItem)).not.toHaveBeenCalled();
	});

	it('continues pipeline when pre-execution linkPRToWorkItem fails', async () => {
		vi.mocked(linkPRToWorkItem).mockRejectedValueOnce(new Error('DB connection failed'));

		await runAgentExecutionPipeline(
			{
				agentType: 'review',
				agentInput: {},
				prNumber: 42,
				prUrl: 'https://github.com/acme/myapp/pull/42',
				prTitle: 'Test PR',
				workItemId: 'card-1',
			},
			PROJECT,
			CONFIG,
		);

		// Agent should still have run despite the linkPRToWorkItem failure
		expect(mockRunAgent).toHaveBeenCalledWith('review', expect.anything());
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'Failed to ensure pr_work_items entry for PR-triggered run',
			expect.objectContaining({
				projectId: 'project-1',
				prNumber: 42,
			}),
		);
	});
});

// ---------------------------------------------------------------------------
// workItemId staleness recovery (via runAgentExecutionPipeline)
// ---------------------------------------------------------------------------

describe('workItemId staleness recovery (via runAgentExecutionPipeline)', () => {
	beforeEach(() => {
		mockCreatePMProvider.mockReturnValue({});
		mockResolveProjectPMConfig.mockReturnValue(PM_CONFIG);
		mockValidateIntegrations.mockResolvedValue({ valid: true, errors: [] });
		mockCheckBudgetExceeded.mockResolvedValue(null);
		mockHandleAgentResultArtifacts.mockResolvedValue(undefined);
		mockShouldTriggerDebug.mockResolvedValue(null);
		mockRunAgent.mockResolvedValue({ success: true, output: '', runId: 'run-1' });
	});

	it('re-resolves workItemId from DB when result.workItemId is undefined but PR is already linked', async () => {
		// Implementation has already linked PR #42 to card-from-db
		mockLookupWorkItemForPR.mockResolvedValueOnce('card-from-db');

		// PROpenedTrigger-style result captured before the link existed
		await runAgentExecutionPipeline(
			{
				agentType: 'review',
				agentInput: { prNumber: 42 },
				prNumber: 42,
				prUrl: 'https://github.com/acme/myapp/pull/42',
				prTitle: 'Test PR',
			},
			PROJECT,
			CONFIG,
		);

		// runAgent receives the resolved workItemId in agentInput
		expect(mockRunAgent).toHaveBeenCalledWith(
			'review',
			expect.objectContaining({ workItemId: 'card-from-db' }),
		);

		// linkPRToWorkItem is called with the resolved workItemId, not null
		expect(vi.mocked(linkPRToWorkItem)).toHaveBeenCalledWith(
			'project-1',
			'acme/myapp',
			42,
			'card-from-db',
			expect.anything(),
		);
	});

	it('preserves trigger-supplied workItemId when DB lookup is unnecessary', async () => {
		// Trigger already carries a workItemId — no DB lookup expected
		await runAgentExecutionPipeline(
			{
				agentType: 'review',
				agentInput: { prNumber: 42, workItemId: 'card-from-trigger' },
				prNumber: 42,
				workItemId: 'card-from-trigger',
				prUrl: 'https://github.com/acme/myapp/pull/42',
			},
			PROJECT,
			CONFIG,
		);

		expect(mockLookupWorkItemForPR).not.toHaveBeenCalled();
		expect(mockRunAgent).toHaveBeenCalledWith(
			'review',
			expect.objectContaining({ workItemId: 'card-from-trigger' }),
		);
	});

	it('leaves workItemId undefined when neither trigger nor DB has one', async () => {
		// Default mockLookupWorkItemForPR returns null
		await runAgentExecutionPipeline(
			{
				agentType: 'review',
				agentInput: { prNumber: 42 },
				prNumber: 42,
				prUrl: 'https://github.com/acme/myapp/pull/42',
			},
			PROJECT,
			CONFIG,
		);

		expect(mockLookupWorkItemForPR).toHaveBeenCalledWith('project-1', 42);
		expect(vi.mocked(linkPRToWorkItem)).toHaveBeenCalledWith(
			'project-1',
			'acme/myapp',
			42,
			null,
			expect.anything(),
		);
	});
});

// ---------------------------------------------------------------------------
// Post-completion review dispatch (via runAgentExecutionPipeline)
// ---------------------------------------------------------------------------

describe('post-completion review dispatch (via runAgentExecutionPipeline)', () => {
	beforeEach(() => {
		mockCreatePMProvider.mockReturnValue({});
		mockResolveProjectPMConfig.mockReturnValue(PM_CONFIG);
		mockValidateIntegrations.mockResolvedValue({ valid: true, errors: [] });
		mockCheckBudgetExceeded.mockResolvedValue(null);
		mockHandleAgentResultArtifacts.mockResolvedValue(undefined);
		mockShouldTriggerDebug.mockResolvedValue(null);
		mockParseRepoFullName.mockReturnValue({ owner: 'acme', repo: 'myapp' });
		mockGithubClient.getPR.mockResolvedValue({
			title: 'feat: test PR',
			headSha: 'sha-abc123',
			head: { ref: 'feat/test' },
		});
		mockGithubClient.getCheckSuiteStatus.mockResolvedValue({ allPassing: true });
		mockClaimReviewDispatch.mockReturnValue(true);
		mockBuildReviewDispatchKey.mockReturnValue('acme/myapp:42:sha-abc123');
	});

	it('fires review after successful implementation with prUrl and green CI', async () => {
		mockRunAgent
			.mockResolvedValueOnce({
				success: true,
				output: '',
				runId: 'run-impl',
				prUrl: 'https://github.com/acme/myapp/pull/42',
			})
			.mockResolvedValueOnce({ success: true, output: '', runId: 'run-review' });

		await runAgentExecutionPipeline(
			{ agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
		);

		// runAgent called twice: implementation + review
		expect(mockRunAgent).toHaveBeenCalledTimes(2);
		expect(mockRunAgent).toHaveBeenNthCalledWith(
			2,
			'review',
			expect.objectContaining({ project: PROJECT }),
		);
		expect(mockClaimReviewDispatch).toHaveBeenCalled();
	});

	it('does NOT fire review when agentType is not implementation', async () => {
		mockRunAgent.mockResolvedValueOnce({
			success: true,
			output: '',
			runId: 'run-review',
			prUrl: 'https://github.com/acme/myapp/pull/42',
		});

		await runAgentExecutionPipeline(
			{ agentType: 'review', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
		);

		expect(mockRunAgent).toHaveBeenCalledTimes(1);
		expect(mockClaimReviewDispatch).not.toHaveBeenCalled();
	});

	it('does NOT fire review when implementation failed', async () => {
		mockRunAgent.mockResolvedValueOnce({
			success: false,
			output: '',
			error: 'build failed',
		});

		await runAgentExecutionPipeline(
			{ agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
		);

		expect(mockRunAgent).toHaveBeenCalledTimes(1);
		expect(mockClaimReviewDispatch).not.toHaveBeenCalled();
	});

	it('does NOT fire review when implementation has no prUrl', async () => {
		mockRunAgent.mockResolvedValueOnce({
			success: true,
			output: '',
			runId: 'run-impl',
		});

		await runAgentExecutionPipeline(
			{ agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
		);

		expect(mockRunAgent).toHaveBeenCalledTimes(1);
		expect(mockGithubClient.getCheckSuiteStatus).not.toHaveBeenCalled();
	});

	it('does NOT fire review when CI is not all green', async () => {
		mockGithubClient.getCheckSuiteStatus.mockResolvedValueOnce({ allPassing: false });
		mockRunAgent.mockResolvedValueOnce({
			success: true,
			output: '',
			runId: 'run-impl',
			prUrl: 'https://github.com/acme/myapp/pull/42',
		});

		await runAgentExecutionPipeline(
			{ agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
		);

		expect(mockRunAgent).toHaveBeenCalledTimes(1);
		expect(mockClaimReviewDispatch).not.toHaveBeenCalled();
	});

	it('does NOT fire review when claimReviewDispatch returns false (already dispatched)', async () => {
		mockClaimReviewDispatch.mockReturnValueOnce(false);
		mockRunAgent.mockResolvedValueOnce({
			success: true,
			output: '',
			runId: 'run-impl',
			prUrl: 'https://github.com/acme/myapp/pull/42',
		});

		await runAgentExecutionPipeline(
			{ agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
		);

		expect(mockRunAgent).toHaveBeenCalledTimes(1);
		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.stringContaining('already dispatched'),
			expect.anything(),
		);
	});

	it('swallows errors gracefully — does not break the implementation pipeline', async () => {
		mockGithubClient.getCheckSuiteStatus.mockRejectedValueOnce(new Error('GitHub API down'));
		mockRunAgent.mockResolvedValueOnce({
			success: true,
			output: '',
			runId: 'run-impl',
			prUrl: 'https://github.com/acme/myapp/pull/42',
		});

		// Pipeline should complete normally despite the hook failing
		await expect(
			runAgentExecutionPipeline(
				{ agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
				PROJECT,
				CONFIG,
			),
		).resolves.not.toThrow();

		expect(mockLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Post-completion review dispatch failed'),
			expect.objectContaining({ error: expect.any(String) }),
		);
	});
});
