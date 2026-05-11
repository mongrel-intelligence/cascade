import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── shared mocks ──────────────────────────────────────────────────────────────
vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../src/router/queue.js', () => ({
	addJob: vi.fn(),
	scheduleCoalescedJob: vi.fn().mockResolvedValue({ jobId: 'cj-1', superseded: false }),
}));
vi.mock('../../../src/pm/coalesce-config.js', () => ({
	getCoalesceWindowMs: vi.fn().mockReturnValue(10_000),
}));
vi.mock('../../../src/router/work-item-lock.js', () => ({
	isWorkItemLocked: vi.fn().mockResolvedValue({ locked: false }),
	markWorkItemEnqueued: vi.fn(),
	clearWorkItemEnqueued: vi.fn(),
}));
vi.mock('../../../src/router/agent-type-lock.js', () => ({
	checkAgentTypeConcurrency: vi.fn().mockResolvedValue({ maxConcurrency: null, blocked: false }),
	markAgentTypeEnqueued: vi.fn(),
	markRecentlyDispatched: vi.fn(),
	clearAgentTypeEnqueued: vi.fn(),
	clearRecentlyDispatched: vi.fn(),
}));
vi.mock('../../../src/router/action-dedup.js', () => ({
	isDuplicateAction: vi.fn().mockReturnValue(false),
	markActionProcessed: vi.fn(),
}));
vi.mock('../../../src/router/lock-state-classifier.js', () => ({
	classifyLockState: vi.fn().mockResolvedValue('awaiting-slot'),
}));
vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

// ── github adapter mocks (for buildJob tests) ─────────────────────────────────
vi.mock('../../../src/router/config.js', () => ({
	loadProjectConfig: vi.fn(),
}));
vi.mock('../../../src/config/projects.js', () => ({
	getProjectGitHubToken: vi.fn().mockResolvedValue('ghp_mock'),
}));
vi.mock('../../../src/config/provider.js', () => ({
	findProjectByRepo: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../../src/github/personas.js', () => ({
	resolvePersonaIdentities: vi.fn().mockResolvedValue({}),
	isCascadeBot: vi.fn().mockReturnValue(false),
}));
vi.mock('../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn().mockImplementation((_t: unknown, fn: () => unknown) => fn()),
}));
vi.mock('../../../src/pm/context.js', () => ({
	withPMProvider: vi.fn().mockImplementation((_p: unknown, fn: () => unknown) => fn()),
	withPMCredentials: vi
		.fn()
		.mockImplementation((_id: unknown, _type: unknown, _get: unknown, fn: () => unknown) => fn()),
}));
vi.mock('../../../src/pm/registry.js', () => ({
	pmRegistry: {
		getOrNull: vi.fn().mockReturnValue(null),
		createProvider: vi.fn().mockReturnValue({}),
	},
}));
vi.mock('../../../src/router/acknowledgments.js', () => ({
	postGitHubAck: vi.fn(),
	resolveGitHubTokenForAckByAgent: vi.fn(),
}));
vi.mock('../../../src/router/pm-ack-dispatch.js', () => ({ dispatchPMAck: vi.fn() }));
vi.mock('../../../src/agents/definitions/loader.js', () => ({
	isPMFocusedAgent: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../../src/router/notifications.js', () => ({ extractPRNumber: vi.fn() }));
vi.mock('../../../src/router/pre-actions.js', () => ({ addEyesReactionToPR: vi.fn() }));
vi.mock('../../../src/router/ackMessageGenerator.js', () => ({
	extractGitHubContext: vi.fn().mockReturnValue('ctx'),
	generateAckMessage: vi.fn().mockResolvedValue('ack'),
}));
vi.mock('../../../src/router/reactions.js', () => ({
	sendAcknowledgeReaction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/utils/runLink.js', () => ({
	buildWorkItemRunsLink: vi.fn().mockReturnValue(''),
	getDashboardUrl: vi.fn().mockReturnValue(''),
}));

// ── imports ───────────────────────────────────────────────────────────────────
import { GitHubRouterAdapter } from '../../../src/router/adapters/github.js';
import type { RouterProjectConfig } from '../../../src/router/config.js';
import { loadProjectConfig } from '../../../src/router/config.js';
import type { RouterPlatformAdapter } from '../../../src/router/platform-adapter.js';
import type { GitHubJob } from '../../../src/router/queue.js';
import { scheduleCoalescedJob } from '../../../src/router/queue.js';
import { processRouterWebhook } from '../../../src/router/webhook-processor.js';
import { isWorkItemLocked } from '../../../src/router/work-item-lock.js';
import { captureException } from '../../../src/sentry.js';
import type { TriggerRegistry } from '../../../src/triggers/registry.js';
import type { TriggerResult } from '../../../src/types/index.js';

// ── fixtures ──────────────────────────────────────────────────────────────────

const mockProject: RouterProjectConfig = { id: 'p1', repo: 'owner/repo', pmType: 'trello' };

const mockTriggerRegistry = {
	dispatch: vi.fn().mockResolvedValue(null),
} as unknown as TriggerRegistry;

const deferredRecheckResult: TriggerResult = {
	agentType: null,
	agentInput: {},
	deferredRecheck: { delayMs: 45_000, coalesceKey: 'p1:pr-conflict-recheck:42' },
};

const deferredBareJob: GitHubJob = {
	type: 'github',
	source: 'github',
	payload: {},
	eventType: 'pull_request',
	repoFullName: 'owner/repo',
	receivedAt: new Date().toISOString(),
	// NOTE: triggerResult intentionally absent — this is the "bare" re-check job
	mergeabilityRecheckAttempt: 1,
};

function makeMockAdapter(overrides: Partial<RouterPlatformAdapter> = {}): RouterPlatformAdapter {
	return {
		type: 'github',
		parseWebhook: vi.fn().mockResolvedValue({
			projectIdentifier: 'owner/repo',
			eventType: 'pull_request',
			workItemId: '42',
			isCommentEvent: false,
		}),
		isProcessableEvent: vi.fn().mockReturnValue(true),
		isSelfAuthored: vi.fn().mockResolvedValue(false),
		sendReaction: vi.fn(),
		resolveProject: vi.fn().mockResolvedValue(mockProject),
		dispatchWithCredentials: vi.fn().mockResolvedValue(null),
		postAck: vi.fn().mockResolvedValue(undefined),
		buildJob: vi.fn().mockReturnValue(deferredBareJob),
		firePreActions: vi.fn(),
		...overrides,
	};
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('TriggerResult.deferredRecheck type field', () => {
	it('accepts deferredRecheck field with correct shape', () => {
		// TypeScript compile-time check (also verified by npm run typecheck).
		// If the field doesn't exist on TriggerResult, this file won't compile.
		const result: TriggerResult = {
			agentType: null,
			agentInput: {},
			deferredRecheck: { delayMs: 45_000, coalesceKey: 'proj:pr-conflict-recheck:42' },
		};
		expect(result.deferredRecheck?.delayMs).toBe(45_000);
		expect(result.deferredRecheck?.coalesceKey).toBe('proj:pr-conflict-recheck:42');
	});
});

describe('GitHubJob.mergeabilityRecheckAttempt type field', () => {
	it('accepts mergeabilityRecheckAttempt field', () => {
		// TypeScript compile-time check. If the field doesn't exist on GitHubJob, this won't compile.
		const job: GitHubJob = {
			type: 'github',
			source: 'github',
			payload: {},
			eventType: 'pull_request',
			repoFullName: 'owner/repo',
			receivedAt: '',
			mergeabilityRecheckAttempt: 1,
		};
		expect(job.mergeabilityRecheckAttempt).toBe(1);
	});

	it('accepts checkSuiteRecheckAttempt field', () => {
		// TypeScript compile-time check for the new field.
		const job: GitHubJob = {
			type: 'github',
			source: 'github',
			payload: {},
			eventType: 'check_suite',
			repoFullName: 'owner/repo',
			receivedAt: '',
			checkSuiteRecheckAttempt: 1,
		};
		expect(job.checkSuiteRecheckAttempt).toBe(1);
	});
});

describe('GitHubRouterAdapter.buildJob — deferred re-check behavior', () => {
	let adapter: GitHubRouterAdapter;

	beforeEach(() => {
		adapter = new GitHubRouterAdapter();
		vi.mocked(loadProjectConfig).mockResolvedValue({
			projects: [mockProject],
			fullProjects: [{ id: 'p1', repo: 'owner/repo' } as never],
		});
	});

	const event = {
		projectIdentifier: 'owner/repo',
		eventType: 'pull_request',
		workItemId: '42',
		isCommentEvent: false,
		repoFullName: 'owner/repo',
	} as ReturnType<GitHubRouterAdapter['parseWebhook']> extends Promise<infer T>
		? NonNullable<T>
		: never;

	it('omits triggerResult when result.deferredRecheck is set', () => {
		const job = adapter.buildJob(
			event,
			{},
			mockProject,
			deferredRecheckResult,
			undefined,
		) as GitHubJob;
		expect(job.triggerResult).toBeUndefined();
	});

	it('sets mergeabilityRecheckAttempt: 1 when result.deferredRecheck is set', () => {
		const job = adapter.buildJob(
			event,
			{},
			mockProject,
			deferredRecheckResult,
			undefined,
		) as GitHubJob;
		expect(job.mergeabilityRecheckAttempt).toBe(1);
	});

	it('includes triggerResult normally when deferredRecheck is absent', () => {
		const normalResult: TriggerResult = {
			agentType: 'resolve-conflicts',
			agentInput: { prNumber: 42 },
		};
		const job = adapter.buildJob(event, {}, mockProject, normalResult, undefined) as GitHubJob;
		expect(job.triggerResult).toBe(normalResult);
	});

	it('does not set mergeabilityRecheckAttempt when deferredRecheck is absent', () => {
		const normalResult: TriggerResult = {
			agentType: 'resolve-conflicts',
			agentInput: { prNumber: 42 },
		};
		const job = adapter.buildJob(event, {}, mockProject, normalResult, undefined) as GitHubJob;
		expect(job.mergeabilityRecheckAttempt).toBeUndefined();
	});

	it('sets checkSuiteRecheckAttempt: 1 when recheckKind is check-suite', () => {
		// Check-suite rechecks must NOT get mergeabilityRecheckAttempt — that field
		// triggers the exhaustion path in processGitHubWebhook.
		const checkSuiteResult: TriggerResult = {
			agentType: null,
			agentInput: {},
			deferredRecheck: {
				delayMs: 30_000,
				coalesceKey: 'check-suite-success:owner/repo:pr-42:sha123',
				recheckKind: 'check-suite',
			},
		};
		const job = adapter.buildJob(event, {}, mockProject, checkSuiteResult, undefined) as GitHubJob;
		expect(job.checkSuiteRecheckAttempt).toBe(1);
		expect(job.mergeabilityRecheckAttempt).toBeUndefined();
	});

	it('sets mergeabilityRecheckAttempt: 1 when recheckKind is absent (backward-compat)', () => {
		// The existing mergeability-recheck case: no recheckKind → mergeabilityRecheckAttempt.
		const job = adapter.buildJob(
			event,
			{},
			mockProject,
			deferredRecheckResult,
			undefined,
		) as GitHubJob;
		expect(job.mergeabilityRecheckAttempt).toBe(1);
		expect(job.checkSuiteRecheckAttempt).toBeUndefined();
	});
});

describe('processRouterWebhook — deferred re-check branch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(scheduleCoalescedJob).mockResolvedValue({
			jobId: 'cj-1',
			superseded: false,
			supersededJobData: undefined,
		});
		vi.mocked(isWorkItemLocked).mockResolvedValue({ locked: false });
	});

	it('calls scheduleCoalescedJob with the built job, coalesceKey, and delayMs', async () => {
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(deferredRecheckResult),
		});
		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(scheduleCoalescedJob).toHaveBeenCalledOnce();
		expect(scheduleCoalescedJob).toHaveBeenCalledWith(
			deferredBareJob,
			'p1:pr-conflict-recheck:42',
			45_000,
		);
	});

	it('returns decisionReason containing coalesceKey', async () => {
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(deferredRecheckResult),
		});
		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(result.decisionReason).toContain('Deferred re-check scheduled');
		expect(result.decisionReason).toContain('p1:pr-conflict-recheck:42');
	});

	it('does NOT call isWorkItemLocked (exits before lock check)', async () => {
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(deferredRecheckResult),
		});
		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(isWorkItemLocked).not.toHaveBeenCalled();
	});

	it('Sentry-captures and returns shouldProcess:true when scheduleCoalescedJob throws', async () => {
		vi.mocked(scheduleCoalescedJob).mockRejectedValueOnce(new Error('Redis down'));
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(deferredRecheckResult),
		});
		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ tags: { source: 'deferred_recheck_schedule_failure' } }),
		);
	});

	it('deferred re-check branch skipped when agentType is non-null', async () => {
		const resultWithAgent: TriggerResult = {
			agentType: 'resolve-conflicts',
			agentInput: { prNumber: 42 },
			deferredRecheck: { delayMs: 45_000, coalesceKey: 'p1:pr-conflict-recheck:42' },
		};
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(resultWithAgent),
		});
		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		// Should have gone to the normal dispatch path, NOT the deferred-recheck branch
		expect(scheduleCoalescedJob).not.toHaveBeenCalledWith(
			expect.anything(),
			'p1:pr-conflict-recheck:42',
			45_000,
		);
	});
});
