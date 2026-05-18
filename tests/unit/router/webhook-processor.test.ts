import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));
vi.mock('../../../src/router/queue.js', () => ({
	addJob: vi.fn(),
	getPendingCoalescedJobData: vi.fn().mockResolvedValue(undefined),
	scheduleCoalescedJob: vi.fn().mockResolvedValue({ jobId: 'coalesce:key', superseded: false }),
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

import { getCoalesceWindowMs } from '../../../src/pm/coalesce-config.js';
import { isDuplicateAction, markActionProcessed } from '../../../src/router/action-dedup.js';
import {
	checkAgentTypeConcurrency,
	clearAgentTypeEnqueued,
	clearRecentlyDispatched,
	markAgentTypeEnqueued,
	markRecentlyDispatched,
} from '../../../src/router/agent-type-lock.js';
import type { RouterProjectConfig } from '../../../src/router/config.js';
import { classifyLockState } from '../../../src/router/lock-state-classifier.js';
import type { RouterPlatformAdapter } from '../../../src/router/platform-adapter.js';
import type { CascadeJob } from '../../../src/router/queue.js';
import {
	addJob,
	getPendingCoalescedJobData,
	scheduleCoalescedJob,
} from '../../../src/router/queue.js';
import { processRouterWebhook } from '../../../src/router/webhook-processor.js';
import {
	clearWorkItemEnqueued,
	isWorkItemLocked,
	markWorkItemEnqueued,
} from '../../../src/router/work-item-lock.js';
import { captureException } from '../../../src/sentry.js';
import type { TriggerRegistry } from '../../../src/triggers/registry.js';

const mockProject: RouterProjectConfig = {
	id: 'p1',
	repo: 'owner/repo',
	pmType: 'trello',
};

const mockTriggerRegistry = {
	dispatch: vi.fn().mockResolvedValue(null),
} as unknown as TriggerRegistry;

function makeMockAdapter(overrides: Partial<RouterPlatformAdapter> = {}): RouterPlatformAdapter {
	return {
		type: 'trello',
		parseWebhook: vi.fn().mockResolvedValue({
			projectIdentifier: 'board1',
			eventType: 'commentCard',
			workItemId: 'card1',
			isCommentEvent: true,
		}),
		isProcessableEvent: vi.fn().mockReturnValue(true),
		isSelfAuthored: vi.fn().mockResolvedValue(false),
		sendReaction: vi.fn(),
		resolveProject: vi.fn().mockResolvedValue(mockProject),
		dispatchWithCredentials: vi.fn().mockResolvedValue(null),
		postAck: vi.fn().mockResolvedValue(undefined),
		buildJob: vi.fn().mockReturnValue({
			type: 'trello',
			source: 'trello',
			payload: {},
			projectId: 'p1',
			cardId: 'card1',
			actionType: 'commentCard',
			receivedAt: new Date().toISOString(),
		} as CascadeJob),
		firePreActions: vi.fn(),
		...overrides,
	};
}

describe('processRouterWebhook', () => {
	it('returns shouldProcess false when parseWebhook returns null', async () => {
		const adapter = makeMockAdapter({
			parseWebhook: vi.fn().mockResolvedValue(null),
		});
		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(false);
		expect(result.decisionReason).toBe('Event unparseable or not processable');
		expect(addJob).not.toHaveBeenCalled();
	});

	it('returns shouldProcess false when action is a duplicate', async () => {
		vi.mocked(isDuplicateAction).mockReturnValueOnce(true);
		const adapter = makeMockAdapter({
			parseWebhook: vi.fn().mockResolvedValue({
				projectIdentifier: 'board1',
				eventType: 'updateCard',
				workItemId: 'card1',
				isCommentEvent: false,
				actionId: 'action-123',
			}),
		});
		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(false);
		expect(result.decisionReason).toBe('Duplicate action');
		expect(addJob).not.toHaveBeenCalled();
		expect(markActionProcessed).not.toHaveBeenCalled();
	});

	it('marks action as processed when not a duplicate', async () => {
		vi.mocked(isDuplicateAction).mockReturnValueOnce(false);
		const adapter = makeMockAdapter({
			parseWebhook: vi.fn().mockResolvedValue({
				projectIdentifier: 'board1',
				eventType: 'updateCard',
				workItemId: 'card1',
				isCommentEvent: false,
				actionId: 'action-456',
			}),
		});
		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(isDuplicateAction).toHaveBeenCalledWith('action-456');
		expect(markActionProcessed).toHaveBeenCalledWith('action-456');
	});

	it('skips dedup check when event has no actionId', async () => {
		const adapter = makeMockAdapter({
			parseWebhook: vi.fn().mockResolvedValue({
				projectIdentifier: 'board1',
				eventType: 'commentCard',
				workItemId: 'card1',
				isCommentEvent: true,
				// no actionId
			}),
		});
		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(isDuplicateAction).not.toHaveBeenCalled();
		expect(markActionProcessed).not.toHaveBeenCalled();
	});

	it('returns shouldProcess false when event is not processable', async () => {
		const adapter = makeMockAdapter({
			isProcessableEvent: vi.fn().mockReturnValue(false),
		});
		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(false);
		expect(result.decisionReason).toBe('Event type not processable: commentCard');
		expect(addJob).not.toHaveBeenCalled();
	});

	it('returns shouldProcess true and does not queue for self-authored events', async () => {
		const adapter = makeMockAdapter({
			isSelfAuthored: vi.fn().mockResolvedValue(true),
		});
		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(result.decisionReason).toBe('Self-authored event (loop prevention)');
		expect(addJob).not.toHaveBeenCalled();
	});

	it('fires reaction for processable events', async () => {
		const adapter = makeMockAdapter();
		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(adapter.sendReaction).toHaveBeenCalled();
	});

	it('returns shouldProcess true without queuing when no project found', async () => {
		const adapter = makeMockAdapter({
			resolveProject: vi.fn().mockResolvedValue(null),
		});
		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(result.decisionReason).toMatch(/No project config for identifier/);
		expect(addJob).not.toHaveBeenCalled();
	});

	it('does not queue when dispatch returns null (no matcher matched)', async () => {
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(null),
		});
		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(result.decisionReason).toBe('No trigger matched for event');
		expect(addJob).not.toHaveBeenCalled();
	});

	// Diagnostic upgrade: a structured skip from a matched handler must be
	// surfaced in decisionReason — distinct from "no matcher matched". Closes
	// the 2026-04-29 ucho/PR#155 incident where check_suite-failure self-skipped
	// for an unknown reason and webhooklogs only said "No trigger matched for
	// event", forcing log-trawling instead of dashboard-level diagnosis.
	it('surfaces handler-specific skipReason in decisionReason when a matched handler self-skipped', async () => {
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue({
				agentType: null,
				agentInput: {},
				skipReason: {
					handler: 'check-suite-failure',
					message: 'Not all checks complete yet, waiting',
				},
			}),
		});
		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(result.decisionReason).toBe(
			'Trigger check-suite-failure skipped: Not all checks complete yet, waiting',
		);
		expect(addJob).not.toHaveBeenCalled();
	});

	it('queues job when dispatch returns a trigger result', async () => {
		const triggerResult = { agentType: 'implementation', agentInput: { cardId: 'card1' } };
		vi.mocked(addJob).mockResolvedValue('job-1');
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
			postAck: vi.fn().mockResolvedValue({ commentId: 'comment-abc', message: 'Starting...' }),
		});

		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(result.projectId).toBe('p1');
		expect(result.decisionReason).toMatch(/Job queued: implementation agent for work item/);
		// postAck is called before buildJob — ack info is embedded at build time
		// The 5th arg is the full triggerResult so PM-focused agents can route ack to PM tool
		expect(adapter.postAck).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'commentCard' }),
			expect.anything(),
			mockProject,
			'implementation',
			triggerResult,
		);
		expect(adapter.buildJob).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'commentCard' }),
			expect.anything(),
			mockProject,
			triggerResult,
			{ commentId: 'comment-abc', message: 'Starting...' },
		);
		expect(addJob).toHaveBeenCalled();
	});

	// 2026-04-29: prod check_suite-triggered respond-to-ci dispatch logged
	// `Job queued: respond-to-ci agent for work item (unknown)` because the
	// GitHub adapter's parseWebhook only extracts `event.workItemId` from
	// `payload.pull_request.number` — `check_suite` payloads have it under
	// `check_suite.pull_requests[0].number`. The trigger handler resolves it
	// internally and returns `result.workItemId` / `result.prNumber`; the
	// decisionReason should prefer those over the parse-time event field.
	it('decisionReason prefers result.workItemId over event.workItemId when both differ', async () => {
		const triggerResult = {
			agentType: 'respond-to-ci',
			agentInput: {},
			workItemId: 'PROJ-42',
		};
		vi.mocked(addJob).mockResolvedValue('job-1');
		const adapter = makeMockAdapter({
			// parseWebhook resolved workItemId to undefined (e.g. check_suite payload)
			parseWebhook: vi.fn().mockResolvedValue({
				eventType: 'check_suite',
				workItemId: undefined,
			}),
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
			postAck: vi.fn().mockResolvedValue({ commentId: 'c', message: 'm' }),
		});

		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.decisionReason).toBe('Job queued: respond-to-ci agent for work item PROJ-42');
	});

	it('decisionReason falls back to result.prNumber when workItemId is unavailable', async () => {
		const triggerResult = {
			agentType: 'respond-to-ci',
			agentInput: {},
			prNumber: 155,
		};
		vi.mocked(addJob).mockResolvedValue('job-1');
		const adapter = makeMockAdapter({
			parseWebhook: vi.fn().mockResolvedValue({
				eventType: 'check_suite',
				workItemId: undefined,
			}),
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
			postAck: vi.fn().mockResolvedValue({ commentId: 'c', message: 'm' }),
		});

		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.decisionReason).toBe('Job queued: respond-to-ci agent for work item PR #155');
	});

	it('posts ack comment before enqueuing job', async () => {
		const callOrder: string[] = [];
		const triggerResult = { agentType: 'implementation', agentInput: {} };
		vi.mocked(addJob).mockImplementation(async () => {
			callOrder.push('addJob');
			return 'job-1';
		});
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
			postAck: vi.fn().mockImplementation(async () => {
				callOrder.push('postAck');
				return { commentId: 'c1', message: 'ack' };
			}),
		});

		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(callOrder).toEqual(['postAck', 'addJob']);
	});

	it('calls buildJob with ackResult when postAck returns a result', async () => {
		const triggerResult = { agentType: 'implementation', agentInput: {} };
		const ackResult = { commentId: 'comment-abc', message: 'Starting...' };
		vi.mocked(addJob).mockResolvedValue('job-1');
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
			postAck: vi.fn().mockResolvedValue(ackResult),
		});

		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		// buildJob must receive ackResult as the 5th argument
		expect(adapter.buildJob).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'commentCard' }),
			expect.anything(),
			mockProject,
			triggerResult,
			ackResult,
		);
	});

	it('still enqueues job when postAck returns undefined', async () => {
		const triggerResult = { agentType: 'implementation', agentInput: {} };
		vi.mocked(addJob).mockResolvedValue('job-1');
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
			postAck: vi.fn().mockResolvedValue(undefined),
		});

		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		// buildJob is called with undefined ackResult
		expect(adapter.buildJob).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'commentCard' }),
			expect.anything(),
			mockProject,
			triggerResult,
			undefined,
		);
		// Job is still enqueued even without ack
		expect(addJob).toHaveBeenCalled();
	});

	it('fires pre-actions before queuing', async () => {
		const triggerResult = { agentType: 'implementation', agentInput: {} };
		vi.mocked(addJob).mockResolvedValue('job-1');
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
			firePreActions: vi.fn(),
		});

		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(adapter.firePreActions).toHaveBeenCalled();
	});

	it('skips queueing for no-agent triggers (GitHub PM-only operations)', async () => {
		const triggerResult = { agentType: null, agentInput: {} };
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
		});

		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(result.decisionReason).toBe('Trigger completed without agent (PM operation)');
		expect(addJob).not.toHaveBeenCalled();
	});

	it('handles dispatch failure gracefully', async () => {
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockRejectedValue(new Error('DB failure')),
		});

		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(addJob).not.toHaveBeenCalled();
	});

	it('still returns successfully even when addJob throws', async () => {
		const onBlocked = vi.fn();
		const triggerResult = { agentType: 'implementation', agentInput: {}, onBlocked };
		vi.mocked(addJob).mockRejectedValue(new Error('Redis down'));
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
		});

		// Should not throw
		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(result.decisionReason).toBe('Failed to enqueue job to Redis');
		expect(onBlocked).toHaveBeenCalledOnce();
	});

	it('calls onBlocked when postAck throws', async () => {
		const onBlocked = vi.fn();
		const triggerResult = { agentType: 'review', agentInput: { prNumber: 42 }, onBlocked };
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
			postAck: vi.fn().mockRejectedValue(new Error('GitHub down')),
		});

		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(result.decisionReason).toBe('Failed to enqueue job to Redis');
		expect(onBlocked).toHaveBeenCalledOnce();
	});

	it('works with adapters that do not implement firePreActions', async () => {
		const triggerResult = { agentType: 'implementation', agentInput: {} };
		vi.mocked(addJob).mockResolvedValue('job-1');
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
			firePreActions: undefined,
		});

		// Should not throw when firePreActions is absent
		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(addJob).toHaveBeenCalled();
	});

	it("emits 'Awaiting worker slot' when lock held and classifier returns 'awaiting-slot' (spec 015/1)", async () => {
		const triggerResult = {
			agentType: 'implementation',
			agentInput: { cardId: 'card1' },
			workItemId: 'card1',
		};
		vi.mocked(isWorkItemLocked).mockResolvedValueOnce({
			locked: true,
			reason: 'in-memory same-type: 1 enqueued (max 1 per type)',
		});
		vi.mocked(classifyLockState).mockResolvedValueOnce('awaiting-slot');
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
		});

		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(result.projectId).toBe('p1');
		expect(result.decisionReason).toBe(
			'Awaiting worker slot: in-memory same-type: 1 enqueued (max 1 per type)',
		);
		expect(addJob).not.toHaveBeenCalled();
		expect(adapter.postAck).not.toHaveBeenCalled();
	});

	it("emits 'Work item locked (no active dispatch)' when classifier returns 'wedged' (spec 015/1)", async () => {
		const triggerResult = {
			agentType: 'implementation',
			agentInput: { cardId: 'card1' },
			workItemId: 'card1',
		};
		vi.mocked(isWorkItemLocked).mockResolvedValueOnce({
			locked: true,
			reason: 'in-memory same-type: 1 enqueued (max 1 per type)',
		});
		vi.mocked(classifyLockState).mockResolvedValueOnce('wedged');
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
		});

		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(result.decisionReason).toBe(
			'Work item locked (no active dispatch): in-memory same-type: 1 enqueued (max 1 per type)',
		);
		// Wedged-lock canary fires a Sentry capture so the regression invariant
		// is loud — see spec 015/1 AC #6.
		expect(captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({
				tags: expect.objectContaining({ source: 'wedged_lock_canary' }),
			}),
		);
	});

	it('preserves existing log fields when work item is locked', async () => {
		const triggerResult = {
			agentType: 'implementation',
			agentInput: { cardId: 'card1' },
			workItemId: 'card1',
		};
		vi.mocked(isWorkItemLocked).mockResolvedValueOnce({
			locked: true,
			reason: 'db: active run exists',
		});
		vi.mocked(classifyLockState).mockResolvedValueOnce('awaiting-slot');
		const { logger } = await import('../../../src/utils/logging.js');
		vi.mocked(logger.info).mockClear();
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
		});

		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		// Find the Skipping … log call. Existing structure pins these fields.
		const skipCall = vi
			.mocked(logger.info)
			.mock.calls.find((c) => String(c[0]).includes('work item already locked'));
		expect(skipCall).toBeDefined();
		expect(skipCall?.[1]).toMatchObject({
			source: 'trello',
			projectId: 'p1',
			workItemId: 'card1',
			blockedAgentType: 'implementation',
			reason: 'db: active run exists',
		});
	});

	it('does not call classifyLockState when work item is not locked (perf invariant)', async () => {
		vi.mocked(classifyLockState).mockClear();
		vi.mocked(isWorkItemLocked).mockResolvedValueOnce({ locked: false });
		const triggerResult = {
			agentType: 'implementation',
			agentInput: { cardId: 'card1' },
			workItemId: 'card1',
		};
		vi.mocked(addJob).mockResolvedValueOnce('job-x');
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
		});

		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		// Happy path must not pay the queue-lookup cost.
		expect(classifyLockState).not.toHaveBeenCalled();
	});

	it('calls onBlocked when work item is locked', async () => {
		const onBlocked = vi.fn();
		const triggerResult = {
			agentType: 'review',
			agentInput: { prNumber: 42 },
			workItemId: 'card1',
			onBlocked,
		};
		vi.mocked(isWorkItemLocked).mockResolvedValueOnce({
			locked: true,
			reason: 'db: active run exists',
		});
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
		});

		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(onBlocked).toHaveBeenCalledOnce();
		expect(addJob).not.toHaveBeenCalled();
	});

	it('calls onBlocked when agent-type concurrency is blocked', async () => {
		const onBlocked = vi.fn();
		vi.mocked(checkAgentTypeConcurrency).mockResolvedValueOnce({
			maxConcurrency: 1,
			blocked: true,
		});
		const triggerResult = {
			agentType: 'review',
			agentInput: { prNumber: 42 },
			onBlocked,
		};
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
		});

		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(onBlocked).toHaveBeenCalledOnce();
		expect(addJob).not.toHaveBeenCalled();
	});

	it('enqueues job and marks work item when not locked', async () => {
		const triggerResult = {
			agentType: 'implementation',
			agentInput: { cardId: 'card1' },
			workItemId: 'card1',
		};
		vi.mocked(addJob).mockResolvedValue('job-1');
		vi.mocked(isWorkItemLocked).mockResolvedValueOnce({ locked: false });
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
		});

		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(addJob).toHaveBeenCalled();
		expect(markWorkItemEnqueued).toHaveBeenCalledWith('p1', 'card1', 'implementation');
	});

	it('skips job when agent-type concurrency is blocked', async () => {
		vi.mocked(checkAgentTypeConcurrency).mockResolvedValueOnce({
			maxConcurrency: 1,
			blocked: true,
		});
		const triggerResult = {
			agentType: 'implementation',
			agentInput: { cardId: 'card1' },
		};
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
		});

		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(result.decisionReason).toBe('Agent type concurrency limit reached');
		expect(addJob).not.toHaveBeenCalled();
	});

	it('always enqueues job when trigger has no workItemId', async () => {
		const triggerResult = {
			agentType: 'debug',
			agentInput: {},
			// no workItemId
		};
		vi.mocked(addJob).mockResolvedValue('job-1');
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
		});

		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(isWorkItemLocked).not.toHaveBeenCalled();
		expect(addJob).toHaveBeenCalled();
		expect(markWorkItemEnqueued).not.toHaveBeenCalled();
	});

	describe('BullMQ delayed-job coalescing', () => {
		beforeEach(() => {
			vi.mocked(isWorkItemLocked).mockReset();
			vi.mocked(checkAgentTypeConcurrency).mockReset();
			vi.mocked(getPendingCoalescedJobData).mockReset();
			vi.mocked(scheduleCoalescedJob).mockReset();
			vi.mocked(isWorkItemLocked).mockResolvedValue({ locked: false });
			vi.mocked(checkAgentTypeConcurrency).mockResolvedValue({
				maxConcurrency: null,
				blocked: false,
			});
			vi.mocked(markWorkItemEnqueued).mockClear();
			vi.mocked(markAgentTypeEnqueued).mockClear();
			vi.mocked(markRecentlyDispatched).mockClear();
			vi.mocked(clearWorkItemEnqueued).mockClear();
			vi.mocked(clearAgentTypeEnqueued).mockClear();
			vi.mocked(clearRecentlyDispatched).mockClear();
			vi.mocked(getPendingCoalescedJobData).mockResolvedValue(undefined);
			vi.mocked(scheduleCoalescedJob).mockResolvedValue({
				jobId: 'coalesce:p1:PROJ-1',
				superseded: false,
			});
			vi.mocked(getCoalesceWindowMs).mockReturnValue(10_000);
		});

		it('schedules a coalesced delayed job when coalesceKey is present', async () => {
			const adapter = makeMockAdapter({
				type: 'jira',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: 'implementation',
					agentInput: { workItemId: 'PROJ-1' },
					workItemId: 'PROJ-1',
					coalesceKey: 'p1:PROJ-1',
				}),
			});

			const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);

			expect(result.shouldProcess).toBe(true);
			expect(result.decisionReason).toMatch(/Coalesced dispatch scheduled/);
			expect(getPendingCoalescedJobData).toHaveBeenCalledWith('p1:PROJ-1');
			expect(scheduleCoalescedJob).toHaveBeenCalledOnce();
			// Immediate addJob must NOT be called for coalesced path
			expect(addJob).not.toHaveBeenCalled();
		});

		it('does not post ack immediately for coalesced jobs (deferred to fire time)', async () => {
			const adapter = makeMockAdapter({
				type: 'jira',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: 'implementation',
					agentInput: { workItemId: 'PROJ-1' },
					workItemId: 'PROJ-1',
					coalesceKey: 'p1:PROJ-1',
				}),
			});

			await processRouterWebhook(adapter, {}, mockTriggerRegistry);

			// postAck must NOT be called at schedule time for coalesced jobs
			expect(adapter.postAck).not.toHaveBeenCalled();
		});

		it('marks work-item lock when coalesced job is scheduled', async () => {
			const adapter = makeMockAdapter({
				type: 'jira',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: 'implementation',
					agentInput: { workItemId: 'PROJ-1' },
					workItemId: 'PROJ-1',
					coalesceKey: 'p1:PROJ-1',
				}),
			});

			await processRouterWebhook(adapter, {}, mockTriggerRegistry);

			expect(markWorkItemEnqueued).toHaveBeenCalledWith('p1', 'PROJ-1', 'implementation');
			expect(markRecentlyDispatched).toHaveBeenCalled();
			expect(markAgentTypeEnqueued).toHaveBeenCalled();
		});

		it('logs supersede when prior delayed job is replaced (UA-21 regression)', async () => {
			vi.mocked(scheduleCoalescedJob).mockResolvedValue({
				jobId: 'coalesce:p1:PROJ-1',
				superseded: true,
			});
			const { logger } = await import('../../../src/utils/logging.js');
			const adapter = makeMockAdapter({
				type: 'jira',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: 'planning',
					agentInput: { workItemId: 'PROJ-1' },
					workItemId: 'PROJ-1',
					coalesceKey: 'p1:PROJ-1',
				}),
			});

			await processRouterWebhook(adapter, {}, mockTriggerRegistry);

			const infoCall = vi
				.mocked(logger.info)
				.mock.calls.find((c) => String(c[0]).includes('superseded prior pending job'));
			expect(infoCall).toBeDefined();
		});

		it('releases superseded job locks when supersededJobData is returned', async () => {
			const supersededJobData: CascadeJob = {
				type: 'jira',
				source: 'jira',
				payload: {},
				projectId: 'p1',
				issueKey: 'PROJ-1',
				webhookEvent: 'jira:issue_created',
				receivedAt: new Date().toISOString(),
				triggerResult: {
					agentType: 'splitting',
					workItemId: 'PROJ-1',
					agentInput: {},
				},
			};
			vi.mocked(scheduleCoalescedJob).mockResolvedValue({
				jobId: 'coalesce:p1:PROJ-1',
				superseded: true,
				supersededJobData,
			});
			const adapter = makeMockAdapter({
				type: 'jira',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: 'planning',
					agentInput: { workItemId: 'PROJ-1' },
					workItemId: 'PROJ-1',
					coalesceKey: 'p1:PROJ-1',
				}),
			});

			await processRouterWebhook(adapter, {}, mockTriggerRegistry);

			// Must clear the superseded job's locks to prevent phantom entries
			expect(clearWorkItemEnqueued).toHaveBeenCalledWith('p1', 'PROJ-1', 'splitting');
			expect(clearAgentTypeEnqueued).toHaveBeenCalledWith('p1', 'splitting');
			expect(clearRecentlyDispatched).toHaveBeenCalledWith('p1', 'splitting', 'PROJ-1');
			// Must still mark locks for the new job
			expect(markWorkItemEnqueued).toHaveBeenCalled();
			expect(markAgentTypeEnqueued).toHaveBeenCalled();
		});

		it('allows a pending coalesced job to be superseded even while its in-memory lock exists', async () => {
			vi.mocked(getPendingCoalescedJobData).mockResolvedValue({
				type: 'jira',
				source: 'jira',
				payload: {},
				projectId: 'p1',
				issueKey: 'PROJ-1',
				webhookEvent: 'jira:issue_updated',
				receivedAt: new Date().toISOString(),
				triggerResult: {
					agentType: 'planning',
					workItemId: 'PROJ-1',
					agentInput: {},
				},
			});
			vi.mocked(scheduleCoalescedJob).mockResolvedValue({
				jobId: 'coalesce:p1:PROJ-1',
				superseded: true,
				supersededJobData: {
					type: 'jira',
					source: 'jira',
					payload: {},
					projectId: 'p1',
					issueKey: 'PROJ-1',
					webhookEvent: 'jira:issue_updated',
					receivedAt: new Date().toISOString(),
					triggerResult: {
						agentType: 'planning',
						workItemId: 'PROJ-1',
						agentInput: {},
					},
				},
			});
			const adapter = makeMockAdapter({
				type: 'jira',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: 'planning',
					agentInput: { workItemId: 'PROJ-1' },
					workItemId: 'PROJ-1',
					coalesceKey: 'p1:PROJ-1',
				}),
			});

			const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);

			expect(result.decisionReason).toMatch(/Coalesced dispatch scheduled/);
			expect(clearWorkItemEnqueued).toHaveBeenCalledWith('p1', 'PROJ-1', 'planning');
			expect(isWorkItemLocked).toHaveBeenCalledWith('p1', 'PROJ-1', 'planning', {
				ignoreInMemoryCount: 1,
			});
			expect(scheduleCoalescedJob).toHaveBeenCalledOnce();
		});

		it('does not skip active same-type locks just because another pending coalesced job exists for the key', async () => {
			vi.mocked(getPendingCoalescedJobData).mockResolvedValue({
				type: 'linear',
				source: 'linear',
				payload: {},
				projectId: 'p1',
				workItemId: 'TF-38',
				eventType: 'Issue',
				receivedAt: new Date().toISOString(),
				triggerResult: {
					agentType: 'planning',
					workItemId: 'TF-38',
					agentInput: {},
				},
			});
			vi.mocked(isWorkItemLocked).mockResolvedValueOnce({
				locked: true,
				reason: 'same-type: 1 running, 0 enqueued (max 1 per type)',
			});
			const adapter = makeMockAdapter({
				type: 'linear',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: 'implementation',
					agentInput: { workItemId: 'TF-38' },
					workItemId: 'TF-38',
					coalesceKey: 'ats:TF-38',
				}),
			});

			const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);

			expect(result.decisionReason).toBe(
				'Awaiting worker slot: same-type: 1 running, 0 enqueued (max 1 per type)',
			);
			expect(clearWorkItemEnqueued).not.toHaveBeenCalled();
			expect(scheduleCoalescedJob).not.toHaveBeenCalled();
			expect(markWorkItemEnqueued).not.toHaveBeenCalled();
		});

		it('leaves pending own locks intact when agent-type concurrency blocks the replacement dispatch', async () => {
			vi.mocked(getPendingCoalescedJobData).mockResolvedValue({
				type: 'linear',
				source: 'linear',
				payload: {},
				projectId: 'p1',
				workItemId: 'TF-38',
				eventType: 'Issue',
				receivedAt: new Date().toISOString(),
				triggerResult: {
					agentType: 'implementation',
					workItemId: 'TF-38',
					agentInput: {},
				},
			});
			vi.mocked(checkAgentTypeConcurrency).mockResolvedValueOnce({
				maxConcurrency: 1,
				blocked: true,
			});
			const adapter = makeMockAdapter({
				type: 'linear',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: 'implementation',
					agentInput: { workItemId: 'TF-38' },
					workItemId: 'TF-38',
					coalesceKey: 'ats:TF-38',
				}),
			});

			const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);

			expect(result.decisionReason).toBe('Agent type concurrency limit reached');
			expect(clearWorkItemEnqueued).not.toHaveBeenCalled();
			expect(clearAgentTypeEnqueued).not.toHaveBeenCalled();
			expect(clearRecentlyDispatched).not.toHaveBeenCalled();
			expect(markWorkItemEnqueued).not.toHaveBeenCalled();
			expect(markAgentTypeEnqueued).not.toHaveBeenCalled();
			expect(markRecentlyDispatched).not.toHaveBeenCalled();
			expect(scheduleCoalescedJob).not.toHaveBeenCalled();
		});

		it('does not release pending own locks when replacement scheduling fails', async () => {
			vi.mocked(getPendingCoalescedJobData).mockResolvedValue({
				type: 'linear',
				source: 'linear',
				payload: {},
				projectId: 'p1',
				workItemId: 'TF-38',
				eventType: 'Issue',
				receivedAt: new Date().toISOString(),
				triggerResult: {
					agentType: 'implementation',
					workItemId: 'TF-38',
					agentInput: {},
				},
			});
			vi.mocked(scheduleCoalescedJob).mockRejectedValue(new Error('Redis down'));
			const adapter = makeMockAdapter({
				type: 'linear',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: 'implementation',
					agentInput: { workItemId: 'TF-38' },
					workItemId: 'TF-38',
					coalesceKey: 'ats:TF-38',
				}),
			});

			const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);

			expect(result.decisionReason).toBe('Failed to schedule coalesced job to Redis');
			expect(clearWorkItemEnqueued).not.toHaveBeenCalled();
			expect(clearAgentTypeEnqueued).not.toHaveBeenCalled();
			expect(clearRecentlyDispatched).not.toHaveBeenCalled();
			expect(markWorkItemEnqueued).not.toHaveBeenCalled();
			expect(markAgentTypeEnqueued).not.toHaveBeenCalled();
			expect(markRecentlyDispatched).not.toHaveBeenCalled();
		});

		it('blocks a late duplicate coalesced dispatch when the same work item and agent type are already locked', async () => {
			vi.mocked(isWorkItemLocked).mockResolvedValueOnce({
				locked: true,
				reason: 'in-memory same-type: 1 enqueued (max 1 per type)',
			});
			const adapter = makeMockAdapter({
				type: 'linear',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: 'phased-plan',
					agentInput: { workItemId: 'TF-38' },
					workItemId: 'TF-38',
					coalesceKey: 'ats:TF-38',
				}),
			});

			const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);

			expect(result.decisionReason).toBe(
				'Awaiting worker slot: in-memory same-type: 1 enqueued (max 1 per type)',
			);
			expect(scheduleCoalescedJob).not.toHaveBeenCalled();
			expect(markWorkItemEnqueued).not.toHaveBeenCalled();
		});

		it('regression pin (MNG-422 2026-04-29): same coalesceKey does NOT block a new schedule when same-type locks are clear', async () => {
			// Before the unique-jobId rewrite, an active job for the same
			// coalesceKey caused scheduleCoalescedJob to return
			// `activeExists: true` and the caller dropped the new event entirely.
			// That silently lost the splitting agent for MNG-422 while planning
			// was still running. After the rewrite, scheduleCoalescedJob always
			// produces a fresh unique jobId; the active prior job no longer
			// blocks the new schedule. Locks ARE marked for the new job and the
			// decision reason is the normal "Coalesced dispatch scheduled".
			vi.mocked(scheduleCoalescedJob).mockResolvedValue({
				jobId: 'coalesce:p1:PROJ-1:1234567890-abc123',
				superseded: false,
			});
			const adapter = makeMockAdapter({
				type: 'jira',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: 'implementation',
					agentInput: { workItemId: 'PROJ-1' },
					workItemId: 'PROJ-1',
					coalesceKey: 'p1:PROJ-1',
				}),
			});

			const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);

			// New job WAS created → locks must be marked
			expect(markWorkItemEnqueued).toHaveBeenCalled();
			expect(markAgentTypeEnqueued).toHaveBeenCalled();
			expect(result.decisionReason).toMatch(/Coalesced dispatch scheduled/);
			expect(result.decisionReason).not.toMatch(/active job already running/);
		});

		it('falls back to normal dispatch when PM_COALESCE_WINDOW_MS=0 (disable)', async () => {
			vi.mocked(getCoalesceWindowMs).mockReturnValue(0);
			vi.mocked(addJob).mockResolvedValue('job-immediate');
			const adapter = makeMockAdapter({
				type: 'jira',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: 'implementation',
					agentInput: { workItemId: 'PROJ-2' },
					workItemId: 'PROJ-2',
					coalesceKey: 'p1:PROJ-2',
				}),
			});

			const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);

			// Window=0 → normal path: scheduleCoalescedJob not called, addJob called
			expect(scheduleCoalescedJob).not.toHaveBeenCalled();
			expect(addJob).toHaveBeenCalled();
			expect(result.decisionReason).toMatch(/Job queued/);
		});

		it('coalesce isolation: different coalesceKeys do not interfere', async () => {
			vi.mocked(addJob).mockResolvedValue('job-y');
			const adapterA = makeMockAdapter({
				type: 'jira',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: 'implementation',
					agentInput: { workItemId: 'PROJ-10' },
					workItemId: 'PROJ-10',
					coalesceKey: 'p1:PROJ-10',
				}),
			});
			const adapterB = makeMockAdapter({
				type: 'jira',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: 'implementation',
					agentInput: { workItemId: 'PROJ-20' },
					workItemId: 'PROJ-20',
					coalesceKey: 'p1:PROJ-20',
				}),
			});

			await processRouterWebhook(adapterA, {}, mockTriggerRegistry);
			await processRouterWebhook(adapterB, {}, mockTriggerRegistry);

			// scheduleCoalescedJob called once per distinct key
			expect(scheduleCoalescedJob).toHaveBeenCalledTimes(2);
			expect(vi.mocked(scheduleCoalescedJob).mock.calls[0][1]).toBe('p1:PROJ-10');
			expect(vi.mocked(scheduleCoalescedJob).mock.calls[1][1]).toBe('p1:PROJ-20');
		});

		it('returns error reason when scheduleCoalescedJob throws', async () => {
			vi.mocked(scheduleCoalescedJob).mockRejectedValue(new Error('Redis down'));
			const onBlocked = vi.fn();
			const adapter = makeMockAdapter({
				type: 'jira',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: 'implementation',
					agentInput: { workItemId: 'PROJ-3' },
					workItemId: 'PROJ-3',
					coalesceKey: 'p1:PROJ-3',
					onBlocked,
				}),
			});

			const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);

			expect(result.decisionReason).toBe('Failed to schedule coalesced job to Redis');
			expect(onBlocked).toHaveBeenCalledOnce();
			expect(addJob).not.toHaveBeenCalled();
		});

		it('skips coalesce path when no agentType (no-agent triggers)', async () => {
			const adapter = makeMockAdapter({
				type: 'jira',
				dispatchWithCredentials: vi.fn().mockResolvedValue({
					agentType: null,
					agentInput: {},
					coalesceKey: 'p1:PROJ-99',
				}),
			});

			const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);

			expect(scheduleCoalescedJob).not.toHaveBeenCalled();
			expect(result.decisionReason).toBe('Trigger completed without agent (PM operation)');
		});
	});
});
