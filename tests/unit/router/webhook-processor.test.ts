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
	jobQueue: {
		getJob: vi.fn().mockResolvedValue({
			data: {},
			updateData: vi.fn().mockResolvedValue(undefined),
		}),
	},
}));
vi.mock('../../../src/router/work-item-lock.js', () => ({
	isWorkItemLocked: vi.fn().mockResolvedValue({ locked: false }),
	markWorkItemEnqueued: vi.fn(),
}));
vi.mock('../../../src/router/agent-type-lock.js', () => ({
	checkAgentTypeConcurrency: vi.fn().mockResolvedValue({ maxConcurrency: null, blocked: false }),
	markAgentTypeEnqueued: vi.fn(),
	markRecentlyDispatched: vi.fn(),
}));

import { checkAgentTypeConcurrency } from '../../../src/router/agent-type-lock.js';
import type { RouterProjectConfig } from '../../../src/router/config.js';
import type { RouterPlatformAdapter } from '../../../src/router/platform-adapter.js';
import { addJob, jobQueue } from '../../../src/router/queue.js';
import type { CascadeJob } from '../../../src/router/queue.js';
import { processRouterWebhook } from '../../../src/router/webhook-processor.js';
import { isWorkItemLocked, markWorkItemEnqueued } from '../../../src/router/work-item-lock.js';
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
		expect(addJob).not.toHaveBeenCalled();
	});

	it('returns shouldProcess false when event is not processable', async () => {
		const adapter = makeMockAdapter({
			isProcessableEvent: vi.fn().mockReturnValue(false),
		});
		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(false);
		expect(addJob).not.toHaveBeenCalled();
	});

	it('returns shouldProcess true and does not queue for self-authored events', async () => {
		const adapter = makeMockAdapter({
			isSelfAuthored: vi.fn().mockResolvedValue(true),
		});
		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
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
		expect(addJob).not.toHaveBeenCalled();
	});

	it('does not queue when dispatch returns null', async () => {
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(null),
		});
		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
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
		// buildJob is called without ack params (ack is patched after enqueue)
		expect(adapter.buildJob).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'commentCard' }),
			expect.anything(),
			mockProject,
			triggerResult,
		);
		expect(addJob).toHaveBeenCalled();
		// postAck is called after enqueue
		expect(adapter.postAck).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'commentCard' }),
			expect.anything(),
			mockProject,
			'implementation',
		);
	});

	it('enqueues job before posting ack comment', async () => {
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
		expect(callOrder).toEqual(['addJob', 'postAck']);
	});

	it('patches ack info onto enqueued job via updateData', async () => {
		const triggerResult = { agentType: 'implementation', agentInput: {} };
		vi.mocked(addJob).mockResolvedValue('job-1');
		const mockUpdateData = vi.fn().mockResolvedValue(undefined);
		vi.mocked(jobQueue.getJob).mockResolvedValue({
			data: { type: 'trello', source: 'trello', payload: {} },
			updateData: mockUpdateData,
		} as never);
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
			postAck: vi.fn().mockResolvedValue({ commentId: 'comment-abc', message: 'Starting...' }),
		});

		await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(jobQueue.getJob).toHaveBeenCalledWith('job-1');
		expect(mockUpdateData).toHaveBeenCalledWith(
			expect.objectContaining({
				ackCommentId: 'comment-abc',
				ackMessage: 'Starting...',
			}),
		);
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
		const triggerResult = { agentType: 'implementation', agentInput: {} };
		vi.mocked(addJob).mockRejectedValue(new Error('Redis down'));
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
		});

		// Should not throw
		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
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

	it('skips job when work item is locked', async () => {
		const triggerResult = {
			agentType: 'implementation',
			agentInput: { cardId: 'card1' },
			workItemId: 'card1',
		};
		vi.mocked(isWorkItemLocked).mockResolvedValueOnce({
			locked: true,
			reason: 'db: active run exists',
		});
		const adapter = makeMockAdapter({
			dispatchWithCredentials: vi.fn().mockResolvedValue(triggerResult),
		});

		const result = await processRouterWebhook(adapter, {}, mockTriggerRegistry);
		expect(result.shouldProcess).toBe(true);
		expect(result.projectId).toBe('p1');
		expect(addJob).not.toHaveBeenCalled();
		expect(adapter.postAck).not.toHaveBeenCalled();
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
		expect(markWorkItemEnqueued).toHaveBeenCalledWith('p1', 'card1');
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
});
