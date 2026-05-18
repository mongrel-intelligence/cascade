import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock BullMQ + redis utils so the module can be imported without a real Redis.
// vi.hoisted() runs before vi.mock() factories so mock instances are available
// inside factory closures.
// ---------------------------------------------------------------------------

const { mockQueueHandlers, mockQueueInstance } = vi.hoisted(() => {
	const mockQueueHandlers = new Map<string, (...args: unknown[]) => void>();
	const mockQueueInstance = {
		on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			mockQueueHandlers.set(event, handler);
		}),
		add: vi.fn().mockResolvedValue({ id: 'test-job-id' }),
		getDelayed: vi.fn().mockResolvedValue([]),
		getWaiting: vi.fn().mockResolvedValue([]),
		getWaitingCount: vi.fn().mockResolvedValue(0),
		getActiveCount: vi.fn().mockResolvedValue(0),
		getCompletedCount: vi.fn().mockResolvedValue(0),
		getFailedCount: vi.fn().mockResolvedValue(0),
	};
	return { mockQueueHandlers, mockQueueInstance };
});

vi.mock('bullmq', () => ({
	Queue: vi.fn().mockImplementation(() => mockQueueInstance),
}));

vi.mock('../../../src/utils/redis.js', () => ({
	parseRedisUrl: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: { redisUrl: 'redis://localhost:6379' },
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

import type { CascadeJob } from '../../../src/router/queue.js';
import {
	addJob,
	getPendingCoalescedJobData,
	getQueueStats,
	hasPendingCoalescedJob,
	scheduleCoalescedJob,
} from '../../../src/router/queue.js';
import { captureException } from '../../../src/sentry.js';
import { logger } from '../../../src/utils/logging.js';

const sampleJob: CascadeJob = {
	type: 'jira',
	source: 'jira',
	payload: {},
	projectId: 'proj-1',
	issueKey: 'PROJ-42',
	webhookEvent: 'jira:issue_created',
	receivedAt: new Date().toISOString(),
};

interface FakeBullJob {
	name: string;
	data: CascadeJob;
	remove: ReturnType<typeof vi.fn>;
}

function makeFakeJob(name: string, data: CascadeJob): FakeBullJob {
	return {
		name,
		data,
		remove: vi.fn().mockResolvedValue(undefined),
	};
}

describe('scheduleCoalescedJob', () => {
	beforeEach(() => {
		mockQueueInstance.getDelayed.mockResolvedValue([]);
		mockQueueInstance.getWaiting.mockResolvedValue([]);
		mockQueueInstance.add.mockResolvedValue({ id: 'mock-id' });
		mockQueueInstance.getWaitingCount.mockResolvedValue(0);
		mockQueueInstance.getActiveCount.mockResolvedValue(0);
		mockQueueInstance.getCompletedCount.mockResolvedValue(0);
		mockQueueInstance.getFailedCount.mockResolvedValue(0);
		vi.mocked(logger.info).mockClear();
		vi.mocked(logger.error).mockClear();
		vi.mocked(captureException).mockClear();
	});

	it('adds an immediate job and returns the BullMQ id', async () => {
		mockQueueInstance.add.mockResolvedValueOnce({ id: 'bull-job-1' });

		await expect(addJob(sampleJob)).resolves.toBe('bull-job-1');

		expect(mockQueueInstance.add).toHaveBeenCalledWith(
			'jira',
			sampleJob,
			expect.objectContaining({ jobId: expect.stringMatching(/^jira-\d+-[a-z0-9]{6}$/) }),
		);
		expect(logger.info).toHaveBeenCalledWith('Job added to queue', {
			id: 'bull-job-1',
			type: 'jira',
		});
	});

	it('falls back to generated id when BullMQ does not return one', async () => {
		mockQueueInstance.add.mockResolvedValueOnce({});

		const jobId = await addJob(sampleJob);

		expect(jobId).toMatch(/^jira-\d+-[a-z0-9]{6}$/);
	});

	it('reports whether a pending coalesced job exists', async () => {
		mockQueueInstance.getDelayed.mockResolvedValueOnce([makeFakeJob('proj-1:PROJ-42', sampleJob)]);
		mockQueueInstance.getWaiting.mockResolvedValueOnce([makeFakeJob('proj-2:PROJ-99', sampleJob)]);

		await expect(hasPendingCoalescedJob('proj-1:PROJ-42')).resolves.toBe(true);
		await expect(hasPendingCoalescedJob('missing:key')).resolves.toBe(false);
	});

	it('returns data for the first pending coalesced job', async () => {
		mockQueueInstance.getDelayed.mockResolvedValueOnce([makeFakeJob('proj-1:PROJ-42', sampleJob)]);

		await expect(getPendingCoalescedJobData('proj-1:PROJ-42')).resolves.toEqual(sampleJob);
	});

	it('returns queue stats from BullMQ counters', async () => {
		mockQueueInstance.getWaitingCount.mockResolvedValueOnce(2);
		mockQueueInstance.getActiveCount.mockResolvedValueOnce(3);
		mockQueueInstance.getCompletedCount.mockResolvedValueOnce(5);
		mockQueueInstance.getFailedCount.mockResolvedValueOnce(7);

		await expect(getQueueStats()).resolves.toEqual({
			waiting: 2,
			active: 3,
			completed: 5,
			failed: 7,
		});
	});

	it('logs and captures queue errors', () => {
		const errorHandler = mockQueueHandlers.get('error');
		const err = new Error('redis down');

		expect(errorHandler).toBeDefined();
		errorHandler?.(err);

		expect(logger.error).toHaveBeenCalledWith('Queue error', { error: 'Error: redis down' });
		expect(captureException).toHaveBeenCalledWith(err, { tags: { source: 'job_queue' } });
	});

	it('schedules a new delayed job when no prior pending job exists', async () => {
		const result = await scheduleCoalescedJob(sampleJob, 'proj-1:PROJ-42', 10_000);

		expect(result.superseded).toBe(false);
		expect(result.supersededJobData).toBeUndefined();
		expect(result.jobId).toMatch(/^coalesce_proj-1_PROJ-42_/);
		// The BullMQ "job name" is the coalesceKey — that's what `getDelayed/getWaiting`
		// filter on to find supersede targets.
		expect(mockQueueInstance.add).toHaveBeenCalledWith(
			'proj-1:PROJ-42',
			sampleJob,
			expect.objectContaining({ jobId: result.jobId, delay: 10_000 }),
		);
	});

	it('supersedes a prior delayed job with the same coalesceKey', async () => {
		const priorData: CascadeJob = {
			...sampleJob,
			triggerResult: {
				agentType: 'planning',
				workItemId: 'PROJ-42',
				agentInput: {},
			},
		};
		const priorJob = makeFakeJob('proj-1:PROJ-42', priorData);
		mockQueueInstance.getDelayed.mockResolvedValue([priorJob]);

		const result = await scheduleCoalescedJob(sampleJob, 'proj-1:PROJ-42', 10_000);

		expect(result.superseded).toBe(true);
		expect(result.supersededJobData).toEqual(priorData);
		expect(priorJob.remove).toHaveBeenCalledOnce();
		expect(mockQueueInstance.add).toHaveBeenCalledWith(
			'proj-1:PROJ-42',
			sampleJob,
			expect.objectContaining({ jobId: result.jobId, delay: 10_000 }),
		);
	});

	it('supersedes a prior waiting job (in addition to delayed)', async () => {
		const priorJob = makeFakeJob('proj-1:PROJ-42', sampleJob);
		mockQueueInstance.getWaiting.mockResolvedValue([priorJob]);

		const result = await scheduleCoalescedJob(sampleJob, 'proj-1:PROJ-42', 10_000);

		expect(result.superseded).toBe(true);
		expect(priorJob.remove).toHaveBeenCalledOnce();
	});

	it('regression pin (MNG-422 live bug 2026-04-29): does NOT block the new schedule when an active job has the same coalesceKey', async () => {
		// Active jobs do NOT appear in getDelayed/getWaiting — they're in the
		// 'active' set. The new helper deliberately ignores active jobs so the
		// new event always gets its own delayed dispatch. Before this fix, the
		// helper reused the deterministic jobId `coalesce:${coalesceKey}` and
		// BullMQ silently no-op'd add() because of the duplicate id; the
		// splitting agent for MNG-422 was silently dropped while planning was
		// still running.
		mockQueueInstance.getDelayed.mockResolvedValue([]);
		mockQueueInstance.getWaiting.mockResolvedValue([]);

		const result = await scheduleCoalescedJob(sampleJob, 'proj-1:PROJ-42', 10_000);

		expect(result.superseded).toBe(false);
		expect(mockQueueInstance.add).toHaveBeenCalledOnce();
		expect(mockQueueInstance.add).toHaveBeenCalledWith(
			'proj-1:PROJ-42',
			sampleJob,
			expect.objectContaining({ jobId: result.jobId, delay: 10_000 }),
		);
	});

	it('regression pin: does NOT block the new schedule when a completed/failed job exists with the same coalesceKey', async () => {
		// Completed/failed jobs also do NOT appear in getDelayed/getWaiting.
		// Before this fix, the helper would fall through to add() with the
		// deterministic jobId, BullMQ silently no-op'd because the completed
		// job (kept for 24h via `removeOnComplete: { age: 86400 }`) still held
		// the id. New webhooks within 24h after a planning run would silently
		// disappear.
		mockQueueInstance.getDelayed.mockResolvedValue([]);
		mockQueueInstance.getWaiting.mockResolvedValue([]);

		const result = await scheduleCoalescedJob(sampleJob, 'proj-1:PROJ-42', 10_000);

		expect(result.superseded).toBe(false);
		expect(mockQueueInstance.add).toHaveBeenCalledOnce();
	});

	it('only supersedes pending jobs whose name === coalesceKey (does not touch unrelated jobs)', async () => {
		const matching = makeFakeJob('proj-1:PROJ-42', sampleJob);
		const unrelated = makeFakeJob('proj-2:OTHER-99', sampleJob);
		mockQueueInstance.getDelayed.mockResolvedValue([matching, unrelated]);

		await scheduleCoalescedJob(sampleJob, 'proj-1:PROJ-42', 10_000);

		expect(matching.remove).toHaveBeenCalledOnce();
		expect(unrelated.remove).not.toHaveBeenCalled();
	});

	it('returns a unique jobId on each call (regression pin against deterministic-id reuse)', async () => {
		const a = await scheduleCoalescedJob(sampleJob, 'proj-1:PROJ-42', 10_000);
		// Force a non-zero delta so the timestamp suffix differs even on fast clocks.
		await new Promise((r) => setTimeout(r, 2));
		const b = await scheduleCoalescedJob(sampleJob, 'proj-1:PROJ-42', 10_000);

		expect(a.jobId).not.toBe(b.jobId);
		expect(a.jobId).toMatch(/^coalesce_proj-1_PROJ-42_/);
		expect(b.jobId).toMatch(/^coalesce_proj-1_PROJ-42_/);
	});

	it('uses the coalesceKey as the BullMQ job name and as a colon-replaced prefix in the jobId', async () => {
		const result = await scheduleCoalescedJob(sampleJob, 'my-project:ISSUE-99', 5_000);

		// jobId has colons replaced with `_` so BullMQ accepts it and Docker
		// container names derived from it stay valid.
		expect(result.jobId).toMatch(/^coalesce_my-project_ISSUE-99_/);
		expect(result.jobId).not.toContain(':');
		// The BullMQ name (which we filter on for supersede) keeps the original colons.
		expect(mockQueueInstance.add).toHaveBeenCalledWith(
			'my-project:ISSUE-99',
			expect.anything(),
			expect.objectContaining({ jobId: result.jobId, delay: 5_000 }),
		);
	});
});
