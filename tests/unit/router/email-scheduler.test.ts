import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports
// ---------------------------------------------------------------------------

vi.mock('../../../src/db/repositories/settingsRepository.js', () => ({
	getAllProjectIdsWithEmailIntegration: vi.fn(),
}));

vi.mock('../../../src/queue/client.js', () => ({
	submitDashboardJob: vi.fn().mockResolvedValue('job-id'),
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: {
		emailScheduleIntervalMs: 10_000,
	},
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { getAllProjectIdsWithEmailIntegration } from '../../../src/db/repositories/settingsRepository.js';
import { submitDashboardJob } from '../../../src/queue/client.js';
import { startEmailScheduler, stopEmailScheduler } from '../../../src/router/email-scheduler.js';
import { logger } from '../../../src/utils/logging.js';

const mockGetProjectIds = vi.mocked(getAllProjectIdsWithEmailIntegration);
const mockSubmit = vi.mocked(submitDashboardJob);
const mockLogger = vi.mocked(logger);

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.useFakeTimers();
	mockGetProjectIds.mockResolvedValue([]);
	mockSubmit.mockResolvedValue('job-id');
	mockLogger.warn.mockReset();
	mockLogger.info.mockReset();
	mockLogger.error.mockReset();
	mockLogger.debug.mockReset();
});

afterEach(async () => {
	stopEmailScheduler();
	vi.useRealTimers();
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// startEmailScheduler
// ---------------------------------------------------------------------------

describe('startEmailScheduler', () => {
	it('runs an immediate check on start', async () => {
		mockGetProjectIds.mockResolvedValue(['proj-1']);

		startEmailScheduler();
		await vi.advanceTimersByTimeAsync(0); // drain microtasks from the immediate void call

		expect(mockGetProjectIds).toHaveBeenCalledTimes(1);
	});

	it('runs checks on each interval tick', async () => {
		mockGetProjectIds.mockResolvedValue([]);

		startEmailScheduler();
		await vi.advanceTimersByTimeAsync(0); // immediate run

		await vi.advanceTimersByTimeAsync(10_000); // first tick
		await vi.advanceTimersByTimeAsync(10_000); // second tick

		// initial + 2 ticks
		expect(mockGetProjectIds).toHaveBeenCalledTimes(3);
	});

	it('does not create a second interval when called twice', () => {
		startEmailScheduler();
		startEmailScheduler();

		expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('already started'));
	});

	it('only fires one set of checks per interval after double-start attempt', async () => {
		mockGetProjectIds.mockResolvedValue([]);

		startEmailScheduler();
		startEmailScheduler(); // guard: no-op
		await vi.advanceTimersByTimeAsync(0);

		await vi.advanceTimersByTimeAsync(10_000);

		// One immediate + one tick (not doubled)
		expect(mockGetProjectIds).toHaveBeenCalledTimes(2);
	});
});

// ---------------------------------------------------------------------------
// stopEmailScheduler
// ---------------------------------------------------------------------------

describe('stopEmailScheduler', () => {
	it('stops the scheduler — no more checks after stop', async () => {
		mockGetProjectIds.mockResolvedValue([]);

		startEmailScheduler();
		await vi.advanceTimersByTimeAsync(0); // consume the immediate run
		mockGetProjectIds.mockClear();

		stopEmailScheduler();

		await vi.advanceTimersByTimeAsync(30_000);

		expect(mockGetProjectIds).not.toHaveBeenCalled();
	});

	it('is idempotent — safe to call when not started', () => {
		expect(() => stopEmailScheduler()).not.toThrow();
	});

	it('allows restart after stop', async () => {
		mockGetProjectIds.mockResolvedValue([]);

		startEmailScheduler();
		await vi.advanceTimersByTimeAsync(0);
		stopEmailScheduler();
		mockGetProjectIds.mockClear();

		startEmailScheduler();
		await vi.advanceTimersByTimeAsync(0);

		expect(mockGetProjectIds).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// runEmailChecks — job submission
// ---------------------------------------------------------------------------

describe('runEmailChecks (via scheduler)', () => {
	it('submits one job per project with email integration', async () => {
		mockGetProjectIds.mockResolvedValue(['proj-a', 'proj-b']);

		startEmailScheduler();
		await vi.advanceTimersByTimeAsync(0);

		expect(mockSubmit).toHaveBeenCalledTimes(2);
		expect(mockSubmit).toHaveBeenCalledWith(
			{ type: 'manual-run', projectId: 'proj-a', agentType: 'email-joke' },
			expect.stringContaining('email-joke-proj-a-'),
		);
		expect(mockSubmit).toHaveBeenCalledWith(
			{ type: 'manual-run', projectId: 'proj-b', agentType: 'email-joke' },
			expect.stringContaining('email-joke-proj-b-'),
		);
	});

	it('uses a deterministic window-based jobId', async () => {
		mockGetProjectIds.mockResolvedValue(['proj-x']);

		// Fix time so windowId is predictable
		const fixedNow = 1_000_000_000_000; // ms since epoch
		vi.setSystemTime(fixedNow);

		startEmailScheduler();
		await vi.advanceTimersByTimeAsync(0);

		const expectedWindowId = Math.floor(fixedNow / 10_000);
		expect(mockSubmit).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: 'proj-x' }),
			`email-joke-proj-x-${expectedWindowId}`,
		);
	});

	it('new window produces a different jobId', async () => {
		mockGetProjectIds.mockResolvedValue(['proj-y']);

		const fixedNow = 1_000_000_000_000; // windowId = 100_000_000
		vi.setSystemTime(fixedNow);

		startEmailScheduler();
		await vi.advanceTimersByTimeAsync(0);
		const firstJobId = mockSubmit.mock.calls[0][1] as string;

		// Advance a full interval — triggers the next tick in a new window
		await vi.advanceTimersByTimeAsync(10_000);
		const secondJobId = mockSubmit.mock.calls[1][1] as string;

		expect(secondJobId).toContain('email-joke-proj-y-');
		expect(firstJobId).not.toBe(secondJobId);
	});

	it('skips submission when no projects have email integration', async () => {
		mockGetProjectIds.mockResolvedValue([]);

		startEmailScheduler();
		await vi.advanceTimersByTimeAsync(0);

		expect(mockSubmit).not.toHaveBeenCalled();
		expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('No projects'));
	});

	it('logs error and continues when DB query fails', async () => {
		mockGetProjectIds.mockRejectedValue(new Error('DB down'));

		startEmailScheduler();
		await vi.advanceTimersByTimeAsync(0);

		expect(mockSubmit).not.toHaveBeenCalled();
		expect(mockLogger.error).toHaveBeenCalledWith(
			expect.stringContaining('Failed to query'),
			expect.anything(),
		);
	});

	it('continues submitting other projects if one job submission fails', async () => {
		mockGetProjectIds.mockResolvedValue(['proj-ok', 'proj-fail', 'proj-also-ok']);
		mockSubmit
			.mockResolvedValueOnce('job-1')
			.mockRejectedValueOnce(new Error('queue error'))
			.mockResolvedValueOnce('job-3');

		startEmailScheduler();
		await vi.advanceTimersByTimeAsync(0);

		expect(mockSubmit).toHaveBeenCalledTimes(3);
		expect(mockLogger.error).toHaveBeenCalledWith(
			expect.stringContaining('Failed to submit'),
			expect.objectContaining({ projectId: 'proj-fail' }),
		);
	});
});
