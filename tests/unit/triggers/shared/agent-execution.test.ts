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
	mockGetSessionState,
	mockPostReviewToPM,
	mockPostAgentOutputToPM,
	mockPM_SUMMARY_AGENT_TYPES,
	mockIsOutputBasedAgent,
	mockLookupWorkItemForPR,
	mockGithubClient,
	mockParseRepoFullName,
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
	mockGetSessionState: vi.fn().mockReturnValue({}),
	mockPostReviewToPM: vi.fn().mockResolvedValue(undefined),
	mockPostAgentOutputToPM: vi.fn().mockResolvedValue(undefined),
	mockPM_SUMMARY_AGENT_TYPES: new Set([
		'review',
		'respond-to-ci',
		'respond-to-review',
		'resolve-conflicts',
	]),
	mockIsOutputBasedAgent: vi
		.fn()
		.mockImplementation(
			(t: string) =>
				t === 'respond-to-ci' || t === 'respond-to-review' || t === 'resolve-conflicts',
		),
	mockLookupWorkItemForPR: vi.fn().mockResolvedValue(null),
	mockGithubClient: { getPR: vi.fn().mockResolvedValue({ title: 'feat: test PR' }) },
	mockParseRepoFullName: vi.fn().mockReturnValue({ owner: 'acme', repo: 'myapp' }),
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

vi.mock('../../../../src/gadgets/sessionState.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../src/gadgets/sessionState.js')>();
	return {
		...actual,
		getSessionState: mockGetSessionState,
	};
});

vi.mock('../../../../src/triggers/shared/agent-pm-poster.js', () => ({
	postReviewToPM: mockPostReviewToPM,
	postAgentOutputToPM: mockPostAgentOutputToPM,
	PM_SUMMARY_AGENT_TYPES: mockPM_SUMMARY_AGENT_TYPES,
	isOutputBasedAgent: mockIsOutputBasedAgent,
}));

vi.mock('../../../../src/github/client.js', () => ({
	githubClient: mockGithubClient,
}));

vi.mock('../../../../src/utils/repo.js', () => ({
	parseRepoFullName: mockParseRepoFullName,
}));

import { linkPRToWorkItem } from '../../../../src/db/repositories/prWorkItemsRepository.js';
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
});

// ---------------------------------------------------------------------------
// postAgentSummaryToPM (via runAgentExecutionPipeline)
// ---------------------------------------------------------------------------

describe('postAgentSummaryToPM (via runAgentExecutionPipeline)', () => {
	function setupReviewDefaults() {
		mockCreatePMProvider.mockReturnValue({});
		mockResolveProjectPMConfig.mockReturnValue(PM_CONFIG);
		mockValidateIntegrations.mockResolvedValue({ valid: true, errors: [] });
		mockCheckBudgetExceeded.mockResolvedValue(null);
		mockHandleAgentResultArtifacts.mockResolvedValue(undefined);
		mockShouldTriggerDebug.mockResolvedValue(null);
	}

	beforeEach(() => {
		setupReviewDefaults();
	});

	it('calls postReviewToPM when agentType=review, success, and sessionState has reviewBody', async () => {
		mockRunAgent.mockResolvedValueOnce({
			success: true,
			output: '',
			runId: 'run-rev',
			progressCommentId: 'pm-comment-1',
		});
		mockGetSessionState.mockReturnValue({
			reviewBody: 'Looks good',
			reviewEvent: 'APPROVE',
			reviewUrl: 'https://github.com/acme/myapp/pull/42#pullrequestreview-1',
		});

		await runAgentExecutionPipeline(
			{ agentType: 'review', agentInput: {}, workItemId: 'card-1', prNumber: 42 },
			PROJECT,
			CONFIG,
		);

		expect(mockPostReviewToPM).toHaveBeenCalledWith(
			'card-1',
			expect.objectContaining({ reviewBody: 'Looks good' }),
			'pm-comment-1',
		);
	});

	it('skips PM posting entirely for non-summary agent types (implementation)', async () => {
		mockRunAgent.mockResolvedValueOnce({ success: true, output: '', runId: 'run-impl' });
		mockGetSessionState.mockReturnValue({ reviewBody: 'something' });

		await runAgentExecutionPipeline(
			{ agentType: 'implementation', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
		);

		expect(mockPostReviewToPM).not.toHaveBeenCalled();
		expect(mockPostAgentOutputToPM).not.toHaveBeenCalled();
	});

	it('skips when agent failed', async () => {
		mockRunAgent.mockResolvedValueOnce({ success: false, output: '', error: 'review error' });
		mockGetSessionState.mockReturnValue({ reviewBody: 'Looks good' });

		await runAgentExecutionPipeline(
			{ agentType: 'review', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
		);

		expect(mockPostReviewToPM).not.toHaveBeenCalled();
	});

	it('skips when sessionState has no reviewBody and logs reason', async () => {
		mockRunAgent.mockResolvedValueOnce({ success: true, output: '', runId: 'run-rev' });
		mockGetSessionState.mockReturnValue({ reviewBody: null });

		await runAgentExecutionPipeline(
			{ agentType: 'review', agentInput: {}, workItemId: 'card-1' },
			PROJECT,
			CONFIG,
		);

		expect(mockPostReviewToPM).not.toHaveBeenCalled();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'Review PM posting skipped: no reviewBody in session state',
		);
	});

	it('resolves workItemId from DB when result.workItemId is undefined', async () => {
		mockRunAgent.mockResolvedValueOnce({ success: true, output: '', runId: 'run-rev' });
		mockGetSessionState.mockReturnValue({
			reviewBody: 'Nice',
			reviewEvent: 'COMMENT',
			reviewUrl: 'https://github.com/acme/myapp/pull/99#pullrequestreview-5',
		});
		mockLookupWorkItemForPR.mockResolvedValueOnce('card-from-db');

		await runAgentExecutionPipeline(
			{ agentType: 'review', agentInput: {}, prNumber: 99 },
			PROJECT,
			CONFIG,
		);

		expect(mockLookupWorkItemForPR).toHaveBeenCalledWith('project-1', 99);
		expect(mockPostReviewToPM).toHaveBeenCalledWith(
			'card-from-db',
			expect.objectContaining({ reviewBody: 'Nice' }),
			undefined,
		);
	});

	it('skips when no workItemId found (neither result nor DB) and logs reason', async () => {
		mockRunAgent.mockResolvedValueOnce({ success: true, output: '', runId: 'run-rev' });
		mockGetSessionState.mockReturnValue({
			reviewBody: 'Good',
			reviewEvent: 'APPROVE',
			reviewUrl: 'https://github.com/acme/myapp/pull/55#pullrequestreview-6',
		});
		mockLookupWorkItemForPR.mockResolvedValueOnce(null);

		await runAgentExecutionPipeline(
			{ agentType: 'review', agentInput: {}, prNumber: 55 },
			PROJECT,
			CONFIG,
		);

		expect(mockPostReviewToPM).not.toHaveBeenCalled();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'Agent PM posting skipped: no workItemId found',
			expect.objectContaining({ agentType: 'review', projectId: 'project-1', prNumber: 55 }),
		);
	});

	it('calls postAgentOutputToPM for respond-to-ci with successful result and non-empty output', async () => {
		mockRunAgent.mockResolvedValueOnce({
			success: true,
			output: 'Fixed CI by updating the build config.',
			runId: 'run-ci',
			progressCommentId: 'pm-prog-ci',
		});

		await runAgentExecutionPipeline(
			{ agentType: 'respond-to-ci', agentInput: {}, workItemId: 'card-2', prNumber: 10 },
			PROJECT,
			CONFIG,
		);

		expect(mockPostAgentOutputToPM).toHaveBeenCalledWith(
			'card-2',
			'respond-to-ci',
			'Fixed CI by updating the build config.',
			'pm-prog-ci',
		);
		expect(mockPostReviewToPM).not.toHaveBeenCalled();
	});

	it('calls postAgentOutputToPM for respond-to-review with successful result', async () => {
		mockRunAgent.mockResolvedValueOnce({
			success: true,
			output: 'Addressed all review comments.',
			runId: 'run-rr',
			progressCommentId: 'pm-prog-rr',
		});

		await runAgentExecutionPipeline(
			{ agentType: 'respond-to-review', agentInput: {}, workItemId: 'card-3' },
			PROJECT,
			CONFIG,
		);

		expect(mockPostAgentOutputToPM).toHaveBeenCalledWith(
			'card-3',
			'respond-to-review',
			'Addressed all review comments.',
			'pm-prog-rr',
		);
	});

	it('calls postAgentOutputToPM for resolve-conflicts with successful result', async () => {
		mockRunAgent.mockResolvedValueOnce({
			success: true,
			output: 'Resolved merge conflicts in 3 files.',
			runId: 'run-rc',
		});

		await runAgentExecutionPipeline(
			{ agentType: 'resolve-conflicts', agentInput: {}, workItemId: 'card-4' },
			PROJECT,
			CONFIG,
		);

		expect(mockPostAgentOutputToPM).toHaveBeenCalledWith(
			'card-4',
			'resolve-conflicts',
			'Resolved merge conflicts in 3 files.',
			undefined,
		);
	});

	it('delegates empty output to postAgentOutputToPM (which handles the guard)', async () => {
		mockRunAgent.mockResolvedValueOnce({
			success: true,
			output: '',
			runId: 'run-ci-empty',
		});

		await runAgentExecutionPipeline(
			{ agentType: 'respond-to-ci', agentInput: {}, workItemId: 'card-5' },
			PROJECT,
			CONFIG,
		);

		// The pipeline calls postAgentOutputToPM — the empty-output guard lives there, not here
		expect(mockPostAgentOutputToPM).toHaveBeenCalledWith('card-5', 'respond-to-ci', '', undefined);
	});

	it('does not call postAgentOutputToPM when agent failed', async () => {
		mockRunAgent.mockResolvedValueOnce({
			success: false,
			output: 'Some output before failure.',
			error: 'CI fix failed',
		});

		await runAgentExecutionPipeline(
			{ agentType: 'respond-to-ci', agentInput: {}, workItemId: 'card-6' },
			PROJECT,
			CONFIG,
		);

		expect(mockPostAgentOutputToPM).not.toHaveBeenCalled();
		expect(mockPostReviewToPM).not.toHaveBeenCalled();
	});

	it('does not post to PM for splitting agent type', async () => {
		// Extra mock setup needed because splitting's success path triggers
		// propagateAutoLabelAfterSplitting, which calls getPMProvider().
		mockCreatePMProvider.mockReturnValue({});
		mockResolveProjectPMConfig.mockReturnValue(PM_CONFIG);
		mockGetPMProvider.mockReturnValue(
			mockProvider({ listWorkItems: vi.fn().mockResolvedValue([]) }),
		);
		mockHasAutoLabel.mockReturnValue(false);
		mockRunAgent.mockResolvedValueOnce({
			success: true,
			output: 'Split card into 3 sub-cards.',
			runId: 'run-split',
		});

		await runAgentExecutionPipeline(
			{ agentType: 'splitting', agentInput: {}, workItemId: 'card-8' },
			PROJECT,
			CONFIG,
		);

		expect(mockPostReviewToPM).not.toHaveBeenCalled();
		expect(mockPostAgentOutputToPM).not.toHaveBeenCalled();
	});

	it('passes progressCommentId through', async () => {
		mockRunAgent.mockResolvedValueOnce({
			success: true,
			output: '',
			runId: 'run-rev',
			progressCommentId: 'pm-prog-xyz',
		});
		mockGetSessionState.mockReturnValue({
			reviewBody: 'All good',
			reviewEvent: 'APPROVE',
			reviewUrl: 'https://github.com/acme/myapp/pull/42#pullrequestreview-7',
		});

		await runAgentExecutionPipeline(
			{ agentType: 'review', agentInput: {}, workItemId: 'card-1', prNumber: 42 },
			PROJECT,
			CONFIG,
		);

		expect(mockPostReviewToPM).toHaveBeenCalledWith('card-1', expect.anything(), 'pm-prog-xyz');
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
		mockGetSessionState.mockReturnValue({});
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
		mockGetSessionState.mockReturnValue({});
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
