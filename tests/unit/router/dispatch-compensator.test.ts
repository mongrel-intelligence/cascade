import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the worker-env extractors so we can drive their return values per test
// without standing up the manifest registry / DB lookups they normally consult.
vi.mock('../../../src/router/worker-env.js', () => ({
	extractProjectIdFromJob: vi.fn(),
	extractWorkItemId: vi.fn(),
	extractAgentType: vi.fn(),
}));

vi.mock('../../../src/router/work-item-lock.js', () => ({
	clearWorkItemEnqueued: vi.fn(),
}));

vi.mock('../../../src/router/agent-type-lock.js', () => ({
	clearAgentTypeEnqueued: vi.fn(),
	clearRecentlyDispatched: vi.fn(),
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockCreateRun = vi.fn().mockResolvedValue('stub-run-id');
const mockCompleteRun = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	createRun: (...args: unknown[]) => mockCreateRun(...args),
	completeRun: (...args: unknown[]) => mockCompleteRun(...args),
}));

const mockLoadProjectConfig = vi.fn().mockResolvedValue({ projects: [], fullProjects: [] });
vi.mock('../../../src/router/config.js', () => ({
	loadProjectConfig: (...args: unknown[]) => mockLoadProjectConfig(...args),
}));

import {
	clearAgentTypeEnqueued,
	clearRecentlyDispatched,
} from '../../../src/router/agent-type-lock.js';
import {
	recordSpawnFailureStub,
	releaseLocksForFailedJob,
} from '../../../src/router/dispatch-compensator.js';
import { clearWorkItemEnqueued } from '../../../src/router/work-item-lock.js';
import {
	extractAgentType,
	extractProjectIdFromJob,
	extractWorkItemId,
} from '../../../src/router/worker-env.js';
import { captureException } from '../../../src/sentry.js';

const mockExtractProjectIdFromJob = vi.mocked(extractProjectIdFromJob);
const mockExtractWorkItemId = vi.mocked(extractWorkItemId);
const mockExtractAgentType = vi.mocked(extractAgentType);
const mockClearWorkItemEnqueued = vi.mocked(clearWorkItemEnqueued);
const mockClearAgentTypeEnqueued = vi.mocked(clearAgentTypeEnqueued);
const mockClearRecentlyDispatched = vi.mocked(clearRecentlyDispatched);
const mockCaptureException = vi.mocked(captureException);

describe('releaseLocksForFailedJob', () => {
	beforeEach(() => {
		mockExtractProjectIdFromJob.mockReset();
		mockExtractWorkItemId.mockReset();
		mockExtractAgentType.mockReset();
		mockClearWorkItemEnqueued.mockReset();
		mockClearAgentTypeEnqueued.mockReset();
		mockClearRecentlyDispatched.mockReset();
		mockCaptureException.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('releases work-item, agent-type, and recently-dispatched marks for a CascadeJob with all three identifiers', async () => {
		mockExtractProjectIdFromJob.mockResolvedValue('p1');
		mockExtractWorkItemId.mockReturnValue('w1');
		mockExtractAgentType.mockReturnValue('implementation');

		// biome-ignore lint/suspicious/noExplicitAny: test fixture, shape is irrelevant
		await releaseLocksForFailedJob({ type: 'linear' } as any);

		expect(mockClearWorkItemEnqueued).toHaveBeenCalledTimes(1);
		expect(mockClearWorkItemEnqueued).toHaveBeenCalledWith('p1', 'w1', 'implementation');
		expect(mockClearAgentTypeEnqueued).toHaveBeenCalledTimes(1);
		expect(mockClearAgentTypeEnqueued).toHaveBeenCalledWith('p1', 'implementation');
		expect(mockClearRecentlyDispatched).toHaveBeenCalledTimes(1);
		expect(mockClearRecentlyDispatched).toHaveBeenCalledWith('p1', 'implementation', 'w1');
	});

	it('no-ops cleanly when projectId is null (e.g. foreign-provider payload)', async () => {
		mockExtractProjectIdFromJob.mockResolvedValue(null);
		mockExtractWorkItemId.mockReturnValue('w1');
		mockExtractAgentType.mockReturnValue('implementation');

		// biome-ignore lint/suspicious/noExplicitAny: test fixture
		await releaseLocksForFailedJob({ type: 'linear' } as any);

		expect(mockClearWorkItemEnqueued).not.toHaveBeenCalled();
		expect(mockClearAgentTypeEnqueued).not.toHaveBeenCalled();
		expect(mockClearRecentlyDispatched).not.toHaveBeenCalled();
	});

	it('releases agent-type-lock + recently-dispatched even when workItemId is undefined', async () => {
		mockExtractProjectIdFromJob.mockResolvedValue('p1');
		mockExtractWorkItemId.mockReturnValue(undefined);
		mockExtractAgentType.mockReturnValue('backlog-manager');

		// biome-ignore lint/suspicious/noExplicitAny: test fixture
		await releaseLocksForFailedJob({ type: 'manual-run', projectId: 'p1' } as any);

		expect(mockClearWorkItemEnqueued).not.toHaveBeenCalled();
		expect(mockClearAgentTypeEnqueued).toHaveBeenCalledWith('p1', 'backlog-manager');
		expect(mockClearRecentlyDispatched).toHaveBeenCalledWith('p1', 'backlog-manager', undefined);
	});

	it('handles a DashboardJob (manual-run) without throwing', async () => {
		mockExtractProjectIdFromJob.mockResolvedValue('p1');
		mockExtractWorkItemId.mockReturnValue('MNG-350');
		mockExtractAgentType.mockReturnValue('implementation');

		await expect(
			releaseLocksForFailedJob({
				type: 'manual-run',
				projectId: 'p1',
				workItemId: 'MNG-350',
				agentType: 'implementation',
			}),
		).resolves.toBeUndefined();
		expect(mockClearWorkItemEnqueued).toHaveBeenCalledWith('p1', 'MNG-350', 'implementation');
	});

	it('captureException when an extractor throws; never propagates', async () => {
		mockExtractProjectIdFromJob.mockRejectedValue(new Error('extractor boom'));

		await expect(
			// biome-ignore lint/suspicious/noExplicitAny: test fixture
			releaseLocksForFailedJob({ type: 'linear' } as any),
		).resolves.toBeUndefined();

		expect(mockCaptureException).toHaveBeenCalledTimes(1);
		const [errArg, ctx] = mockCaptureException.mock.calls[0] ?? [];
		expect(errArg).toBeInstanceOf(Error);
		expect(ctx?.tags?.source).toBe('dispatch_compensator');
	});

	it('skips agent-type / recently-dispatched if agentType is undefined', async () => {
		mockExtractProjectIdFromJob.mockResolvedValue('p1');
		mockExtractWorkItemId.mockReturnValue('w1');
		mockExtractAgentType.mockReturnValue(undefined);

		// biome-ignore lint/suspicious/noExplicitAny: test fixture
		await releaseLocksForFailedJob({ type: 'github' } as any);

		expect(mockClearWorkItemEnqueued).not.toHaveBeenCalled();
		expect(mockClearAgentTypeEnqueued).not.toHaveBeenCalled();
		expect(mockClearRecentlyDispatched).not.toHaveBeenCalled();
	});
});

// Lives next to releaseLocksForFailedJob because it ALSO runs from BullMQ's
// `worker.on('failed')` handler, fires exactly once per permanently-dead job,
// and shares the same extractor/extraction shape. Reviewer concern from PR
// #1408: the recorder must NOT run on retryable failures that BullMQ later
// recovers from — that surface is guaranteed here, not in spawnWorker's catch.
describe('recordSpawnFailureStub', () => {
	beforeEach(() => {
		mockExtractProjectIdFromJob.mockReset();
		mockExtractWorkItemId.mockReset();
		mockExtractAgentType.mockReset();
		mockCreateRun.mockReset().mockResolvedValue('stub-run-id');
		mockCompleteRun.mockReset().mockResolvedValue(undefined);
		mockLoadProjectConfig.mockReset().mockResolvedValue({ projects: [], fullProjects: [] });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('inserts a failed run row with extracted projectId, workItemId, prNumber, agentType, and triggerType', async () => {
		mockExtractProjectIdFromJob.mockResolvedValue('p1');
		mockExtractWorkItemId.mockReturnValue('w1');
		mockExtractAgentType.mockReturnValue('review');

		const err = new Error('worker died at boot');
		await recordSpawnFailureStub(
			{
				type: 'github',
				triggerResult: {
					prNumber: 2273,
					agentInput: { triggerType: 'review-requested' },
				},
			},
			err,
		);

		expect(mockCreateRun).toHaveBeenCalledWith({
			projectId: 'p1',
			workItemId: 'w1',
			prNumber: 2273,
			agentType: 'review',
			engine: 'unknown',
			triggerType: 'review-requested',
		});
		expect(mockCompleteRun).toHaveBeenCalledWith(
			'stub-run-id',
			expect.objectContaining({
				status: 'failed',
				durationMs: 0,
				error: expect.stringContaining('worker died at boot'),
			}),
		);
	});

	it('resolves the engine from project config when available', async () => {
		mockExtractProjectIdFromJob.mockResolvedValue('p2');
		mockExtractWorkItemId.mockReturnValue(undefined);
		mockExtractAgentType.mockReturnValue('implementation');
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'p2',
					agentEngine: { default: 'codex', overrides: { implementation: 'opencode' } },
				},
			],
		});

		await recordSpawnFailureStub({ type: 'trello' }, new Error('boom'));

		expect(mockCreateRun).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: 'p2', agentType: 'implementation', engine: 'opencode' }),
		);
	});

	it('falls back to engine="unknown" when loadProjectConfig throws (must not block visibility)', async () => {
		mockExtractProjectIdFromJob.mockResolvedValue('p3');
		mockExtractWorkItemId.mockReturnValue('w3');
		mockExtractAgentType.mockReturnValue('review');
		mockLoadProjectConfig.mockRejectedValue(new Error('config read failed'));

		await recordSpawnFailureStub({ type: 'github' }, new Error('boom'));

		expect(mockCreateRun).toHaveBeenCalledWith(expect.objectContaining({ engine: 'unknown' }));
	});

	it('skips the row when projectId is null', async () => {
		mockExtractProjectIdFromJob.mockResolvedValue(null);
		mockExtractAgentType.mockReturnValue('review');

		await recordSpawnFailureStub({ type: 'github' }, new Error('boom'));

		expect(mockCreateRun).not.toHaveBeenCalled();
	});

	it('skips the row when agentType cannot be resolved', async () => {
		mockExtractProjectIdFromJob.mockResolvedValue('p4');
		mockExtractAgentType.mockReturnValue(undefined);

		await recordSpawnFailureStub({ type: 'github' }, new Error('boom'));

		expect(mockCreateRun).not.toHaveBeenCalled();
	});

	it('never throws even if createRun rejects', async () => {
		mockExtractProjectIdFromJob.mockResolvedValue('p5');
		mockExtractWorkItemId.mockReturnValue('w5');
		mockExtractAgentType.mockReturnValue('review');
		mockCreateRun.mockRejectedValue(new Error('DB down'));

		await expect(
			recordSpawnFailureStub({ type: 'github' }, new Error('boom')),
		).resolves.toBeUndefined();
		expect(mockCompleteRun).not.toHaveBeenCalled();
	});
});
