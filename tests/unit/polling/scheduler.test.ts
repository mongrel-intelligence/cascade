import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock pollingConfig before imports
let mockPollingEnabled = true;
vi.mock('../../../src/polling/config.js', () => ({
	pollingConfig: {
		get enabled() {
			return mockPollingEnabled;
		},
		intervalMs: 60000,
	},
}));

// Mock Redis utils
vi.mock('../../../src/utils/redis.js', () => ({
	parseRedisUrl: vi.fn().mockReturnValue({
		host: 'localhost',
		port: 6379,
	}),
}));

// Mock BullMQ
const mockQueueClose = vi.fn().mockResolvedValue(undefined);
const mockUpsertJobScheduler = vi.fn().mockResolvedValue(undefined);
const mockWorkerClose = vi.fn().mockResolvedValue(undefined);
const mockWorkerOn = vi.fn();

vi.mock('bullmq', () => ({
	Queue: vi.fn().mockImplementation(() => ({
		close: mockQueueClose,
		upsertJobScheduler: mockUpsertJobScheduler,
	})),
	Worker: vi.fn().mockImplementation(() => ({
		close: mockWorkerClose,
		on: mockWorkerOn,
	})),
}));

// Mock project loading and router config
const mockLoadProjectConfig = vi.fn().mockResolvedValue({ fullProjects: [] });
vi.mock('../../../src/router/config.js', () => ({
	loadProjectConfig: () => mockLoadProjectConfig(),
	routerConfig: {
		redisUrl: 'redis://localhost:6379',
	},
}));

// Mock GitHub token retrieval
vi.mock('../../../src/config/projects.js', () => ({
	getProjectGitHubToken: vi.fn().mockRejectedValue(new Error('No token')),
}));

// Mock Jira bot identity resolver
vi.mock('../../../src/router/bot-identity-resolvers.js', () => ({
	resolveJiraBotAccountId: vi.fn().mockResolvedValue(null),
}));

// Mock Jira credentials resolver
vi.mock('../../../src/router/platformClients/index.js', () => ({
	resolveJiraCredentials: vi.fn().mockResolvedValue(null),
}));

// Mock trigger registry
vi.mock('../../../src/triggers/builtins.js', () => ({
	registerBuiltInTriggers: vi.fn(),
}));

vi.mock('../../../src/triggers/registry.js', () => ({
	createTriggerRegistry: vi.fn().mockReturnValue({
		dispatch: vi.fn(),
	}),
}));

// Mock pollers
vi.mock('../../../src/polling/providers/github/check-suite-poller.js', () => ({
	pollCheckSuitesForRepo: vi
		.fn()
		.mockResolvedValue({ emitted: 0, errors: 0, total: 0, skipped: 0 }),
}));

vi.mock('../../../src/polling/providers/github/pr-review-poller.js', () => ({
	pollPRReviewsForRepo: vi
		.fn()
		.mockResolvedValue({ emitted: 0, errors: 0, total: 0, skipped: 0, openPRs: [] }),
}));

vi.mock('../../../src/polling/providers/github/pr-conflict-poller.js', () => ({
	pollPRConflictsForRepo: vi
		.fn()
		.mockResolvedValue({ emitted: 0, errors: 0, total: 0, skipped: 0 }),
}));

vi.mock('../../../src/polling/providers/github/merged-pr-poller.js', () => ({
	pollMergedPRsForRepo: vi.fn().mockResolvedValue({ emitted: 0, errors: 0, total: 0, skipped: 0 }),
}));

vi.mock('../../../src/polling/cold-start.js', () => ({
	handleGitHubRepoColdStart: vi.fn().mockResolvedValue({ seeded: 0, skipped: 0 }),
}));

vi.mock('../../../src/polling/providers/jira/index.js', () => ({
	pollJiraStatusChanges: vi.fn().mockResolvedValue({ emitted: 0, errors: 0, total: 0, skipped: 0 }),
}));

vi.mock('../../../src/polling/adapter.js', () => ({
	getPollingAdapter: vi.fn().mockReturnValue({ type: 'github' }),
}));

// Note: cleanup mock moved to cleanup-scheduling.test.ts for better isolation
vi.mock('../../../src/polling/cleanup.js', () => ({
	cleanupPollingLedger: vi.fn().mockResolvedValue(0),
}));

// Mock sentry
vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

// Mock Octokit
vi.mock('@octokit/rest', () => ({
	Octokit: vi.fn().mockImplementation(() => ({})),
}));

// Mock logger
const mockLoggerInfo = vi.fn();
const mockLoggerDebug = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: (...args: unknown[]) => mockLoggerInfo(...args),
		debug: (...args: unknown[]) => mockLoggerDebug(...args),
		warn: (...args: unknown[]) => mockLoggerWarn(...args),
		error: (...args: unknown[]) => mockLoggerError(...args),
	},
}));

import { Queue, Worker } from 'bullmq';
import { getProjectGitHubToken } from '../../../src/config/projects.js';
import { pollPRConflictsForRepo } from '../../../src/polling/providers/github/pr-conflict-poller.js';
import { pollPRReviewsForRepo } from '../../../src/polling/providers/github/pr-review-poller.js';
import { startPollingScheduler, stopPollingScheduler } from '../../../src/polling/scheduler.js';

describe('startPollingScheduler', () => {
	const originalEnv = process.env.REDIS_URL;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.REDIS_URL = 'redis://localhost:6379';
		mockPollingEnabled = true;
	});

	afterEach(async () => {
		await stopPollingScheduler();
		process.env.REDIS_URL = originalEnv;
	});

	it('does nothing when POLLING_ENABLED=false', async () => {
		mockPollingEnabled = false;

		await startPollingScheduler();

		expect(Queue).not.toHaveBeenCalled();
		expect(Worker).not.toHaveBeenCalled();
		expect(mockLoggerInfo).toHaveBeenCalledWith('Polling is disabled, scheduler not started');
	});

	it('creates queue and worker when enabled', async () => {
		mockPollingEnabled = true;

		await startPollingScheduler();

		expect(Queue).toHaveBeenCalledWith('polling-scheduler', expect.any(Object));
		expect(Worker).toHaveBeenCalledWith(
			'polling-scheduler',
			expect.any(Function),
			expect.objectContaining({
				concurrency: 1,
			}),
		);
	});

	it('calls upsertJobScheduler with correct interval', async () => {
		mockPollingEnabled = true;

		await startPollingScheduler();

		expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
			'poll-scheduler',
			{ every: 60000 },
			expect.objectContaining({
				name: 'poll-cycle',
				data: {},
			}),
		);
	});

	it('ensures single-runner guarantee via concurrency 1', async () => {
		mockPollingEnabled = true;

		await startPollingScheduler();

		expect(Worker).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(Function),
			expect.objectContaining({
				concurrency: 1,
			}),
		);
	});

	it('logs error when REDIS_URL not set', async () => {
		delete process.env.REDIS_URL;
		mockPollingEnabled = true;

		await startPollingScheduler();

		expect(mockLoggerError).toHaveBeenCalledWith(
			'REDIS_URL not set, cannot start polling scheduler',
		);
		expect(Queue).not.toHaveBeenCalled();
	});
});

describe('runPollCycle (via scheduler internals)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPollingEnabled = true;
		process.env.REDIS_URL = 'redis://localhost:6379';
	});

	afterEach(async () => {
		await stopPollingScheduler();
	});

	it('logs and returns when no projects configured', async () => {
		mockLoadProjectConfig.mockResolvedValueOnce({ fullProjects: [] });

		// Start scheduler to get the worker callback
		await startPollingScheduler();

		// Get the worker callback and execute it
		const workerCallback = vi.mocked(Worker).mock.calls[0][1] as () => Promise<void>;
		await workerCallback();

		expect(mockLoggerDebug).toHaveBeenCalledWith('No projects configured, skipping poll cycle');
	});

	it('skips project without GitHub token and logs warning', async () => {
		mockLoadProjectConfig.mockResolvedValueOnce({
			fullProjects: [
				{
					id: 'p1',
					name: 'Test Project',
					repo: 'owner/repo',
				},
			],
		});

		vi.mocked(getProjectGitHubToken).mockRejectedValueOnce(new Error('No token'));

		await startPollingScheduler();

		const workerCallback = vi.mocked(Worker).mock.calls[0][1] as () => Promise<void>;
		await workerCallback();

		expect(mockLoggerWarn).toHaveBeenCalledWith(
			'No GitHub token for project, skipping',
			expect.objectContaining({ projectId: 'p1' }),
		);
	});
});

describe('stopPollingScheduler', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPollingEnabled = true;
		process.env.REDIS_URL = 'redis://localhost:6379';
	});

	it('closes queue and worker when called', async () => {
		await startPollingScheduler();
		await stopPollingScheduler();

		expect(mockQueueClose).toHaveBeenCalled();
		expect(mockWorkerClose).toHaveBeenCalled();
	});

	it('logs scheduler stopped', async () => {
		await startPollingScheduler();
		vi.clearAllMocks();
		await stopPollingScheduler();

		expect(mockLoggerInfo).toHaveBeenCalledWith('Polling scheduler stopped');
	});
});

describe('conflict poller integration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPollingEnabled = true;
		process.env.REDIS_URL = 'redis://localhost:6379';
	});

	afterEach(async () => {
		await stopPollingScheduler();
	});

	it('passes openPRs from review poller to conflict poller', async () => {
		const mockOpenPRs = [
			{ number: 1, draft: false, head: { sha: 'abc' }, base: { ref: 'main' } },
			{ number: 2, draft: true, head: { sha: 'def' }, base: { ref: 'main' } },
		];
		vi.mocked(pollPRReviewsForRepo).mockResolvedValueOnce({
			emitted: 0,
			errors: 0,
			total: 0,
			skipped: 0,
			openPRs: mockOpenPRs as never,
		});
		vi.mocked(getProjectGitHubToken).mockResolvedValueOnce('token');
		mockLoadProjectConfig.mockResolvedValueOnce({
			fullProjects: [{ id: 'p1', name: 'Test', repo: 'owner/repo' }],
		});

		await startPollingScheduler();
		const workerCallback = vi.mocked(Worker).mock.calls[0][1] as () => Promise<void>;
		await workerCallback();

		expect(pollPRConflictsForRepo).toHaveBeenCalledWith(
			'p1',
			'owner',
			'repo',
			expect.anything(),
			expect.anything(),
			expect.anything(),
			mockOpenPRs,
		);
	});

	it('skips conflict poller when review poller failed (openPRs empty with errors)', async () => {
		vi.mocked(pollPRReviewsForRepo).mockResolvedValueOnce({
			emitted: 0,
			errors: 1, // Failed
			total: 0,
			skipped: 0,
			openPRs: [], // Empty due to failure
		});
		vi.mocked(getProjectGitHubToken).mockResolvedValueOnce('token');
		mockLoadProjectConfig.mockResolvedValueOnce({
			fullProjects: [{ id: 'p1', name: 'Test', repo: 'owner/repo' }],
		});

		await startPollingScheduler();
		const workerCallback = vi.mocked(Worker).mock.calls[0][1] as () => Promise<void>;
		await workerCallback();

		expect(pollPRConflictsForRepo).not.toHaveBeenCalled();
	});

	it('runs conflict poller when openPRs is empty but no errors (no PRs in repo)', async () => {
		vi.mocked(pollPRReviewsForRepo).mockResolvedValueOnce({
			emitted: 0,
			errors: 0,
			total: 0,
			skipped: 0,
			openPRs: [], // Empty but no errors - valid, repo has no open PRs
		});
		vi.mocked(getProjectGitHubToken).mockResolvedValueOnce('token');
		mockLoadProjectConfig.mockResolvedValueOnce({
			fullProjects: [{ id: 'p1', name: 'Test', repo: 'owner/repo' }],
		});

		await startPollingScheduler();
		const workerCallback = vi.mocked(Worker).mock.calls[0][1] as () => Promise<void>;
		await workerCallback();

		expect(pollPRConflictsForRepo).toHaveBeenCalledWith(
			'p1',
			'owner',
			'repo',
			expect.anything(),
			expect.anything(),
			expect.anything(),
			[],
		);
	});

	it('isolates conflict poller exception from other pollers', async () => {
		vi.mocked(pollPRReviewsForRepo).mockResolvedValueOnce({
			emitted: 1,
			errors: 0,
			total: 1,
			skipped: 0,
			openPRs: [{ number: 1 }] as never,
		});
		vi.mocked(pollPRConflictsForRepo).mockRejectedValueOnce(new Error('Conflict poller crashed'));
		vi.mocked(getProjectGitHubToken).mockResolvedValueOnce('token');
		mockLoadProjectConfig.mockResolvedValueOnce({
			fullProjects: [{ id: 'p1', name: 'Test', repo: 'owner/repo' }],
		});

		await startPollingScheduler();
		const workerCallback = vi.mocked(Worker).mock.calls[0][1] as () => Promise<void>;

		// Should not throw - exception is caught
		await expect(workerCallback()).resolves.not.toThrow();

		// Should log the error
		expect(mockLoggerError).toHaveBeenCalledWith(
			'Failed to poll PR conflicts',
			expect.objectContaining({
				projectId: 'p1',
				error: 'Error: Conflict poller crashed',
			}),
		);
	});
});

// Note: Cleanup scheduling tests are in cleanup-scheduling.test.ts
// They test maybeRunLedgerCleanup() directly for better isolation
