import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/router/worker-env.js', () => ({
	extractProjectIdFromJob: vi.fn(),
	extractWorkItemId: vi.fn(),
	extractAgentType: vi.fn(),
}));

vi.mock('../../../src/router/work-item-lock.js', () => ({
	isWorkItemLocked: vi.fn(),
	markWorkItemEnqueued: vi.fn(),
}));

vi.mock('../../../src/router/agent-type-lock.js', () => ({
	markAgentTypeEnqueued: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { markAgentTypeEnqueued } from '../../../src/router/agent-type-lock.js';
import { admitDelayedRetry } from '../../../src/router/subscription-admission.js';
import { isWorkItemLocked, markWorkItemEnqueued } from '../../../src/router/work-item-lock.js';
import {
	extractAgentType,
	extractProjectIdFromJob,
	extractWorkItemId,
} from '../../../src/router/worker-env.js';
import { logger } from '../../../src/utils/logging.js';

const mockIsLocked = vi.mocked(isWorkItemLocked);
const mockMarkWorkItem = vi.mocked(markWorkItemEnqueued);
const mockMarkAgentType = vi.mocked(markAgentTypeEnqueued);

function job(name: string, data: Record<string, unknown> = {}, attemptsMade = 0) {
	return { id: 'job-1', name, attemptsMade, data: { type: 'github', ...data } } as never;
}

const delayed = (attemptsMade = 0) =>
	job('subrl_proj-1_card-1_implementation', { subscriptionDelayedRetries: 1 }, attemptsMade);

describe('admitDelayedRetry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(extractProjectIdFromJob).mockResolvedValue('proj-1');
		vi.mocked(extractWorkItemId).mockReturnValue('card-1');
		vi.mocked(extractAgentType).mockReturnValue('implementation');
		mockIsLocked.mockResolvedValue({ locked: false });
	});

	it('passes normal jobs through without lock calls', async () => {
		expect(await admitDelayedRetry(job('github'))).toBe(true);
		expect(mockIsLocked).not.toHaveBeenCalled();
		expect(mockMarkWorkItem).not.toHaveBeenCalled();
		expect(mockMarkAgentType).not.toHaveBeenCalled();
	});

	it('passes an immediate requeue of a former delayed retry through untouched', async () => {
		expect(await admitDelayedRetry(job('github', { subscriptionDelayedRetries: 1 }))).toBe(true);
		expect(mockIsLocked).not.toHaveBeenCalled();
		expect(mockMarkAgentType).not.toHaveBeenCalled();
	});

	it('passes a subrl_-named job without the retry counter through untouched', async () => {
		expect(await admitDelayedRetry(job('subrl_coalesce-key'))).toBe(true);
		expect(mockIsLocked).not.toHaveBeenCalled();
	});

	it('drops a delayed retry with a WARN when the work item is locked, marking nothing', async () => {
		mockIsLocked.mockResolvedValue({ locked: true, reason: 'same-type' });
		expect(await admitDelayedRetry(delayed())).toBe(false);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('Dropping delayed retry'),
			expect.objectContaining({ workItemId: 'card-1' }),
		);
		expect(mockMarkWorkItem).not.toHaveBeenCalled();
		expect(mockMarkAgentType).not.toHaveBeenCalled();
	});

	it('marks work item and agent type when unlocked', async () => {
		expect(await admitDelayedRetry(delayed())).toBe(true);
		expect(mockIsLocked).toHaveBeenCalledWith('proj-1', 'card-1', 'implementation', {
			ignoreInMemoryCount: 0,
		});
		expect(mockMarkWorkItem).toHaveBeenCalledWith('proj-1', 'card-1', 'implementation');
		expect(mockMarkAgentType).toHaveBeenCalledWith('proj-1', 'implementation');
	});

	it('checks with ignoreInMemoryCount 0 and marks again on a BullMQ retry attempt', async () => {
		expect(await admitDelayedRetry(delayed(1))).toBe(true);
		expect(mockIsLocked).toHaveBeenCalledWith('proj-1', 'card-1', 'implementation', {
			ignoreInMemoryCount: 0,
		});
		expect(mockMarkAgentType).toHaveBeenCalledTimes(1);
	});

	it('marks only the agent type when there is no work item', async () => {
		vi.mocked(extractWorkItemId).mockReturnValue(undefined);
		expect(await admitDelayedRetry(delayed())).toBe(true);
		expect(mockIsLocked).not.toHaveBeenCalled();
		expect(mockMarkWorkItem).not.toHaveBeenCalled();
		expect(mockMarkAgentType).toHaveBeenCalledWith('proj-1', 'implementation');
	});

	it('admits without marking when the project id is unknown', async () => {
		vi.mocked(extractProjectIdFromJob).mockResolvedValue(null);
		expect(await admitDelayedRetry(delayed())).toBe(true);
		expect(mockMarkAgentType).not.toHaveBeenCalled();
	});

	it('marks both locks before rethrowing when the lock check throws', async () => {
		const err = new Error('db down');
		mockIsLocked.mockRejectedValue(err);
		await expect(admitDelayedRetry(delayed())).rejects.toBe(err);
		expect(mockMarkWorkItem).toHaveBeenCalledWith('proj-1', 'card-1', 'implementation');
		expect(mockMarkAgentType).toHaveBeenCalledWith('proj-1', 'implementation');
	});

	it('marks nothing and rethrows when project id extraction throws', async () => {
		const err = new Error('lookup failed');
		vi.mocked(extractProjectIdFromJob).mockRejectedValue(err);
		await expect(admitDelayedRetry(delayed())).rejects.toBe(err);
		expect(mockMarkWorkItem).not.toHaveBeenCalled();
		expect(mockMarkAgentType).not.toHaveBeenCalled();
	});
});
