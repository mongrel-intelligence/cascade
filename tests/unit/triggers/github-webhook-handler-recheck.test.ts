import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Static mocks (hoisted before imports) ─────────────────────────────────────

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
	flush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/router/queue.js', () => ({
	scheduleCoalescedJob: vi.fn().mockResolvedValue({ jobId: 'cj-1', superseded: false }),
}));

vi.mock('../../../src/triggers/github/integration.js', () => {
	const mockIntegration = {
		type: 'github',
		parseWebhookPayload: vi.fn().mockReturnValue({
			eventType: 'pull_request',
			projectIdentifier: 'owner/repo',
			workItemId: undefined,
			raw: {},
		}),
		lookupProject: vi.fn().mockResolvedValue({
			project: {
				id: 'project-1',
				name: 'Test',
				repo: 'owner/repo',
				baseBranch: 'main',
				watchdogTimeoutMs: 120000,
			},
			config: { projects: [] },
		}),
		withCredentials: vi.fn().mockImplementation((_projectId: unknown, fn: () => unknown) => fn()),
		resolveExecutionConfig: vi.fn().mockReturnValue({
			skipPrepareForAgent: true,
			skipHandleFailure: true,
			handleSuccessOnlyForAgentType: 'implementation',
			logLabel: 'GitHub agent',
		}),
	};
	return { GitHubWebhookIntegration: vi.fn().mockImplementation(() => mockIntegration) };
});

// Spec 024: when the router stamps a projectId the worker resolves the project
// link-first via loadProjectConfigById, not by repo. Returns an id distinct from
// the repo-lookup mock above so the two paths can be told apart in assertions.
vi.mock('../../../src/config/provider.js', () => ({
	loadProjectConfigById: vi.fn().mockResolvedValue({
		project: {
			id: 'linked-project',
			name: 'Linked',
			repo: 'owner/repo',
			baseBranch: 'main',
			watchdogTimeoutMs: 120000,
		},
		config: { projects: [] },
	}),
}));

vi.mock('../../../src/github/personas.js', () => ({
	getPersonaToken: vi.fn().mockResolvedValue('gh-token-xxx'),
	resolvePersonaIdentities: vi
		.fn()
		.mockResolvedValue({ implementer: 'bot', reviewer: 'reviewer-bot' }),
}));

vi.mock('../../../src/github/client.js', () => ({
	githubClient: { deletePRComment: vi.fn().mockResolvedValue(undefined) },
	withGitHubToken: vi.fn().mockImplementation((_token: unknown, fn: () => unknown) => fn()),
}));

vi.mock('../../../src/utils/repo.js', () => ({
	parseRepoFullName: vi.fn().mockReturnValue({ owner: 'owner', repo: 'repo' }),
	getWorkspaceDir: vi.fn().mockReturnValue('/tmp/workspace'),
}));

vi.mock('../../../src/agents/definitions/loader.js', () => ({
	isPMFocusedAgent: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../src/router/ackMessageGenerator.js', () => ({
	extractGitHubContext: vi.fn().mockReturnValue('PR context'),
	generateAckMessage: vi.fn().mockResolvedValue('Starting...'),
}));

vi.mock('../../../src/utils/safeOperation.js', () => ({
	safeOperation: vi.fn().mockImplementation((fn: () => unknown) => fn()),
}));

vi.mock('../../../src/triggers/shared/concurrency.js', () => ({
	withAgentTypeConcurrency: vi
		.fn()
		.mockImplementation((_id: unknown, _type: unknown, fn: () => unknown) => fn()),
}));

vi.mock('../../../src/triggers/shared/credential-scope.js', () => ({
	withPMScope: vi.fn().mockImplementation((_project: unknown, fn: () => unknown) => fn()),
}));

vi.mock('../../../src/triggers/shared/pm-ack.js', () => ({
	postPMAckComment: vi.fn().mockResolvedValue('pm-comment-id'),
}));

vi.mock('../../../src/triggers/shared/webhook-execution.js', () => ({
	runAgentWithCredentials: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/triggers/github/ack-comments.js', () => ({
	postAcknowledgmentComment: vi.fn().mockResolvedValue(undefined),
	updateInitialCommentWithError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/utils/index.js', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	startWatchdog: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { loadProjectConfigById } from '../../../src/config/provider.js';
import { scheduleCoalescedJob } from '../../../src/router/queue.js';
import { captureException } from '../../../src/sentry.js';
import { processGitHubWebhook } from '../../../src/triggers/github/webhook-handler.js';
import type { TriggerResult } from '../../../src/types/index.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const deferredRecheckResult: TriggerResult = {
	agentType: null,
	agentInput: {},
	deferredRecheck: { delayMs: 45_000, coalesceKey: 'project-1:pr-conflict-recheck:42' },
};

// Fixture used to simulate the check-suite trigger still returning stale state
// after a re-check dispatch.
const checkSuiteDeferredRecheckResult: TriggerResult = {
	agentType: null,
	agentInput: {},
	deferredRecheck: {
		delayMs: 30_000,
		coalesceKey: 'check-suite-success:owner/repo:pr-42:sha123',
		recheckKind: 'check-suite',
	},
};

const normalResult: TriggerResult = {
	agentType: 'resolve-conflicts',
	agentInput: { prNumber: 42 },
};

function makeRegistry(result: TriggerResult | null) {
	return { dispatch: vi.fn().mockResolvedValue(result) } as never;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('processGitHubWebhook — re-check exhaustion detection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('emits Sentry capture when isRecheckJob=true and trigger returns deferredRecheck', async () => {
		const registry = makeRegistry(deferredRecheckResult);
		await processGitHubWebhook({}, 'pull_request', registry, undefined, undefined, undefined, true);
		expect(captureException).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('mergeability_recheck_exhausted'),
			}),
			expect.objectContaining({ tags: { source: 'mergeability_recheck_exhausted' } }),
		);
	});

	it('does NOT capture Sentry when isRecheckJob=false and trigger returns deferredRecheck', async () => {
		const registry = makeRegistry(deferredRecheckResult);
		await processGitHubWebhook(
			{},
			'pull_request',
			registry,
			undefined,
			undefined,
			undefined,
			false,
		);
		expect(captureException).not.toHaveBeenCalled();
	});

	it('does NOT capture Sentry when isRecheckJob=true but trigger returns non-deferredRecheck result', async () => {
		const registry = makeRegistry(normalResult);
		await processGitHubWebhook({}, 'pull_request', registry, undefined, undefined, undefined, true);
		expect(captureException).not.toHaveBeenCalled();
	});

	it('does NOT capture Sentry when triggerResult is pre-resolved (no re-dispatch)', async () => {
		const registry = makeRegistry(null);
		await processGitHubWebhook(
			{},
			'pull_request',
			registry,
			undefined,
			undefined,
			normalResult,
			true,
		);
		expect(captureException).not.toHaveBeenCalled();
		expect(registry.dispatch).not.toHaveBeenCalled();
	});
});

describe('processGitHubWebhook — check-suite re-check rescheduling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('reschedules via scheduleCoalescedJob when isCheckSuiteRecheckJob=true and trigger returns deferredRecheck', async () => {
		// This is the case where the worker fires a check-suite recheck but the
		// Actions API is still stale (trigger returns another deferredRecheck).
		// The fix: reschedule instead of treating as exhausted.
		const registry = makeRegistry(checkSuiteDeferredRecheckResult);
		await processGitHubWebhook(
			{},
			'check_suite',
			registry,
			undefined,
			undefined,
			undefined,
			false, // isRecheckJob (mergeability) = false
			true, // isCheckSuiteRecheckJob = true
		);
		// Must reschedule with checkSuiteRecheckAttempt: 1
		expect(scheduleCoalescedJob).toHaveBeenCalledOnce();
		expect(scheduleCoalescedJob).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'github', checkSuiteRecheckAttempt: 1 }),
			'check-suite-success:owner/repo:pr-42:sha123',
			30_000,
		);
		// Must NOT fire the mergeability_recheck_exhausted Sentry capture
		expect(captureException).not.toHaveBeenCalled();
	});

	it('carries the router-stamped projectId forward onto the rescheduled re-check (link-first, spec 024)', async () => {
		// The reviewer's concern (PR #1545): on a shared repository the rescheduled
		// check-suite re-check must carry the ROUTER's link-first project forward,
		// not flip to a repo-resolved sibling. handleRecheckResult stamps
		// requireProjectId(project); because the worker now resolves `project` via
		// loadProjectConfigById(projectId), that id is the link-first one.
		//
		// Dual mutation guard: this fails if handleRecheckResult drops projectId
		// from the rescheduled job, OR if processGitHubWebhook resolves `project`
		// by repo (lookupProject → 'project-1') instead of link-first.
		const registry = makeRegistry(checkSuiteDeferredRecheckResult);
		await processGitHubWebhook(
			{},
			'check_suite',
			registry,
			undefined,
			undefined,
			undefined,
			false, // isRecheckJob (mergeability) = false
			true, // isCheckSuiteRecheckJob = true
			'linked-project', // the router's link-first stamp
		);

		expect(loadProjectConfigById).toHaveBeenCalledWith('linked-project');
		expect(scheduleCoalescedJob).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'github',
				projectId: 'linked-project',
				checkSuiteRecheckAttempt: 1,
			}),
			'check-suite-success:owner/repo:pr-42:sha123',
			30_000,
		);
		expect(captureException).not.toHaveBeenCalled();
	});

	it('does NOT reschedule when isCheckSuiteRecheckJob=false (first-time dispatch falls through normally)', async () => {
		// First-time dispatch where trigger returns deferredRecheck: handled by the
		// router (handleDeferredRecheck); processGitHubWebhook exits via the
		// no-agent path without calling scheduleCoalescedJob.
		const registry = makeRegistry(checkSuiteDeferredRecheckResult);
		await processGitHubWebhook(
			{},
			'check_suite',
			registry,
			undefined,
			undefined,
			undefined,
			false, // isRecheckJob (mergeability) = false
			false, // isCheckSuiteRecheckJob = false
		);
		expect(scheduleCoalescedJob).not.toHaveBeenCalled();
		expect(captureException).not.toHaveBeenCalled();
	});

	it('Sentry-captures and keeps running when scheduleCoalescedJob throws on check-suite reschedule', async () => {
		vi.mocked(scheduleCoalescedJob).mockRejectedValueOnce(new Error('Redis down'));
		const registry = makeRegistry(checkSuiteDeferredRecheckResult);
		// Should not throw even if Redis is down
		await expect(
			processGitHubWebhook(
				{},
				'check_suite',
				registry,
				undefined,
				undefined,
				undefined,
				false,
				true,
			),
		).resolves.toBeUndefined();
		expect(captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ tags: { source: 'check_suite_recheck_reschedule_failure' } }),
		);
	});
});
