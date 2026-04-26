import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/router/active-workers.js', () => ({
	getActiveWorkers: vi.fn(),
}));

vi.mock('../../../src/router/queue.js', () => ({
	jobQueue: {
		getJobs: vi.fn(),
	},
}));

vi.mock('../../../src/router/worker-env.js', () => ({
	extractProjectIdFromJob: vi.fn(),
	extractWorkItemId: vi.fn(),
	extractAgentType: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getActiveWorkers } from '../../../src/router/active-workers.js';
import { classifyLockState } from '../../../src/router/lock-state-classifier.js';
import { jobQueue } from '../../../src/router/queue.js';
import {
	extractAgentType,
	extractProjectIdFromJob,
	extractWorkItemId,
} from '../../../src/router/worker-env.js';

const mockGetActiveWorkers = vi.mocked(getActiveWorkers);
const mockGetJobs = vi.mocked(jobQueue.getJobs);
const mockExtractProjectIdFromJob = vi.mocked(extractProjectIdFromJob);
const mockExtractWorkItemId = vi.mocked(extractWorkItemId);
const mockExtractAgentType = vi.mocked(extractAgentType);

describe('classifyLockState', () => {
	const trio = { projectId: 'ucho', workItemId: 'MNG-350', agentType: 'implementation' as const };

	beforeEach(() => {
		mockGetActiveWorkers.mockReset();
		mockGetJobs.mockReset();
		mockExtractProjectIdFromJob.mockReset();
		mockExtractWorkItemId.mockReset();
		mockExtractAgentType.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns 'awaiting-slot' when an active worker matches the trio", async () => {
		mockGetActiveWorkers.mockReturnValue([
			{
				jobId: 'job-x',
				startedAt: new Date(),
				projectId: 'ucho',
				workItemId: 'MNG-350',
				agentType: 'implementation',
			},
		]);
		mockGetJobs.mockResolvedValue([]);

		const result = await classifyLockState(trio);
		expect(result).toBe('awaiting-slot');
	});

	it("returns 'awaiting-slot' when a queued job in waiting/active state matches the trio", async () => {
		mockGetActiveWorkers.mockReturnValue([]);
		// One job with matching extracted trio
		mockGetJobs.mockResolvedValue([
			// biome-ignore lint/suspicious/noExplicitAny: BullMQ Job test fixture
			{ id: 'q-1', data: { type: 'linear' } } as any,
		]);
		mockExtractProjectIdFromJob.mockResolvedValue('ucho');
		mockExtractWorkItemId.mockReturnValue('MNG-350');
		mockExtractAgentType.mockReturnValue('implementation');

		const result = await classifyLockState(trio);
		expect(result).toBe('awaiting-slot');
	});

	it("returns 'wedged' when no active worker and no queued job matches", async () => {
		mockGetActiveWorkers.mockReturnValue([]);
		mockGetJobs.mockResolvedValue([]);

		const result = await classifyLockState(trio);
		expect(result).toBe('wedged');
	});

	it("returns 'wedged' when active workers and queued jobs exist but for a different trio", async () => {
		mockGetActiveWorkers.mockReturnValue([
			{
				jobId: 'job-other',
				startedAt: new Date(),
				projectId: 'ucho',
				workItemId: 'MNG-999',
				agentType: 'implementation',
			},
		]);
		mockGetJobs.mockResolvedValue([
			// biome-ignore lint/suspicious/noExplicitAny: test fixture
			{ id: 'q-other', data: { type: 'linear' } } as any,
		]);
		mockExtractProjectIdFromJob.mockResolvedValue('ucho');
		mockExtractWorkItemId.mockReturnValue('MNG-998');
		mockExtractAgentType.mockReturnValue('implementation');

		const result = await classifyLockState(trio);
		expect(result).toBe('wedged');
	});

	it("returns 'awaiting-slot' (safe fallback) when the queue lookup throws", async () => {
		mockGetActiveWorkers.mockReturnValue([]);
		mockGetJobs.mockRejectedValue(new Error('redis hiccup'));

		const result = await classifyLockState(trio);
		// Safe fallback: do NOT mis-emit the wedged-lock canary on classifier error.
		expect(result).toBe('awaiting-slot');
	});
});
