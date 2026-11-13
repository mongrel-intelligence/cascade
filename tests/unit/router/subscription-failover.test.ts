import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockAddJob,
	mockQueueAdd,
	mockGetPending,
	mockSelectBest,
	mockEarliest,
	mockMarkWorkItem,
	mockMarkAgentType,
	mockCapture,
} = vi.hoisted(() => ({
	mockAddJob: vi.fn(),
	mockQueueAdd: vi.fn(),
	mockGetPending: vi.fn(),
	mockSelectBest: vi.fn(),
	mockEarliest: vi.fn(),
	mockMarkWorkItem: vi.fn(),
	mockMarkAgentType: vi.fn(),
	mockCapture: vi.fn(),
}));

vi.mock('../../../src/router/queue.js', () => ({
	addJob: mockAddJob,
	getPendingCoalescedJobData: mockGetPending,
	jobQueue: { add: mockQueueAdd },
}));
vi.mock('../../../src/db/repositories/subscriptionsRepository.js', () => ({
	selectBestSubscription: mockSelectBest,
	getEarliestEligibleAt: mockEarliest,
}));
vi.mock('../../../src/router/work-item-lock.js', () => ({
	markWorkItemEnqueued: mockMarkWorkItem,
	clearWorkItemEnqueued: vi.fn(),
}));
vi.mock('../../../src/router/agent-type-lock.js', () => ({
	markAgentTypeEnqueued: mockMarkAgentType,
	clearAgentTypeEnqueued: vi.fn(),
}));
vi.mock('../../../src/sentry.js', () => ({ captureException: mockCapture }));
vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	failOrphanedRun: vi.fn(),
	failOrphanedRunFallback: vi.fn(),
}));

import { type ActiveWorker, activeWorkers } from '../../../src/router/active-workers.js';
import type { CascadeJob } from '../../../src/router/queue.js';
import {
	DELAYED_RETRY_NAME_PREFIX,
	handleRateLimitExit,
} from '../../../src/router/subscription-failover.js';

const MIN = 60_000;
const JITTER = 30 * 60 * 1000;

function setWorker(jobId: string, overrides: Partial<ActiveWorker> = {}, data: object = {}) {
	activeWorkers.set(jobId, {
		containerId: 'c',
		jobId,
		startedAt: new Date(),
		timeoutHandle: setTimeout(() => {}, 0),
		job: { type: 'github', projectId: 'proj-1', ...data } as unknown as CascadeJob,
		projectId: 'proj-1',
		workItemId: 'card-1',
		agentType: 'implementation',
		subscriptionId: 5,
		...overrides,
	});
}

describe('handleRateLimitExit', () => {
	beforeEach(() => {
		activeWorkers.clear();
		for (const m of [
			mockAddJob,
			mockQueueAdd,
			mockGetPending,
			mockSelectBest,
			mockEarliest,
			mockMarkWorkItem,
			mockMarkAgentType,
			mockCapture,
		]) {
			m.mockReset();
		}
		mockAddJob.mockResolvedValue('new-job');
		mockQueueAdd.mockResolvedValue({ id: 'delayed' });
		mockGetPending.mockResolvedValue(undefined);
		mockSelectBest.mockResolvedValue(null);
		mockEarliest.mockResolvedValue(null);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		activeWorkers.clear();
	});

	it('does nothing without a subscription id', async () => {
		setWorker('j', { subscriptionId: undefined });
		expect(await handleRateLimitExit('j')).toBeUndefined();
		expect(mockSelectBest).not.toHaveBeenCalled();
	});

	it('does nothing for a non-requeuable job type', async () => {
		setWorker('j', {}, { type: 'manual-run' });
		expect(await handleRateLimitExit('j')).toBeUndefined();
		expect(mockAddJob).not.toHaveBeenCalled();
	});

	it('requeues on another subscription and re-marks locks only via the callback', async () => {
		setWorker('j', {}, { excludedSubscriptionIds: [2] });
		mockSelectBest.mockResolvedValue({ id: 6, name: 'S6', token: 't' });

		const cb = await handleRateLimitExit('j');

		expect(mockSelectBest).toHaveBeenCalledWith('proj-1', [2, 5]);
		expect(mockAddJob).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'github', excludedSubscriptionIds: [2, 5] }),
		);
		expect(mockMarkWorkItem).not.toHaveBeenCalled();
		expect(mockMarkAgentType).not.toHaveBeenCalled();
		activeWorkers.delete('j');
		cb?.();
		expect(mockMarkWorkItem).toHaveBeenCalledWith('proj-1', 'card-1', 'implementation');
		expect(mockMarkAgentType).toHaveBeenCalledWith('proj-1', 'implementation');
	});

	it('uses addJob (never a subrl_ name) even for a former delayed retry', async () => {
		setWorker('j', {}, { subscriptionDelayedRetries: 2 });
		mockSelectBest.mockResolvedValue({ id: 6, name: 'S6', token: 't' });
		await handleRateLimitExit('j');
		expect(mockAddJob).toHaveBeenCalled();
		expect(mockQueueAdd).not.toHaveBeenCalled();
	});

	it('schedules a delayed retry with jitter and no lock when all are exhausted', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0);
		const now = Date.now();
		vi.spyOn(Date, 'now').mockReturnValue(now);
		mockEarliest.mockResolvedValue(new Date(now + 2 * 60 * 60 * 1000));
		setWorker('j', {}, { excludedSubscriptionIds: [1] });

		expect(await handleRateLimitExit('j')).toBeUndefined();

		const [name, data, opts] = mockQueueAdd.mock.calls[0];
		expect(name).toBe(`${DELAYED_RETRY_NAME_PREFIX}proj-1_card-1_implementation`);
		expect(data).toMatchObject({ excludedSubscriptionIds: [], subscriptionDelayedRetries: 1 });
		expect(opts.delay).toBe(2 * 60 * 60 * 1000);
		expect(opts.jobId.startsWith(DELAYED_RETRY_NAME_PREFIX)).toBe(true);
		expect(mockMarkWorkItem).not.toHaveBeenCalled();
		expect(mockMarkAgentType).not.toHaveBeenCalled();
	});

	it('keeps the delay within [base, base + 30 min)', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.999);
		setWorker('j');
		await handleRateLimitExit('j');
		const delay = mockQueueAdd.mock.calls[0][2].delay;
		expect(delay).toBeGreaterThanOrEqual(60 * 60 * 1000);
		expect(delay).toBeLessThan(60 * 60 * 1000 + JITTER);
	});

	it('uses the 60s minimum and the 1h unknown-reset fallback', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0);
		mockEarliest.mockResolvedValue(new Date(Date.now() + 1000));
		setWorker('a');
		await handleRateLimitExit('a');
		expect(mockQueueAdd.mock.calls[0][2].delay).toBe(MIN);

		mockEarliest.mockResolvedValue(null);
		setWorker('b', { workItemId: 'card-2' });
		await handleRateLimitExit('b');
		expect(mockQueueAdd.mock.calls[1][2].delay).toBe(60 * 60 * 1000);
	});

	it('skips when a delayed retry is already pending for the work item', async () => {
		mockGetPending.mockResolvedValue({ type: 'github' });
		setWorker('j');
		await handleRateLimitExit('j');
		expect(mockQueueAdd).not.toHaveBeenCalled();
	});

	it('gives jobs without a work item distinct names and never dedups them', async () => {
		setWorker('j1', { workItemId: undefined });
		setWorker('j2', { workItemId: undefined });
		await handleRateLimitExit('j1');
		await handleRateLimitExit('j2');
		expect(mockGetPending).not.toHaveBeenCalled();
		expect(mockQueueAdd.mock.calls.map((c) => c[0])).toEqual([
			`${DELAYED_RETRY_NAME_PREFIX}j1`,
			`${DELAYED_RETRY_NAME_PREFIX}j2`,
		]);
	});

	it('drops the event with a Sentry capture once the retry budget is spent', async () => {
		setWorker('j', {}, { subscriptionDelayedRetries: 3 });
		await handleRateLimitExit('j');
		expect(mockQueueAdd).not.toHaveBeenCalled();
		expect(mockCapture).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ tags: { source: 'subscription_failover_budget' } }),
		);
	});
});
