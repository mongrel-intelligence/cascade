import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
}));

vi.mock('../../../src/config/provider.js', () => ({
	findProjectByRepo: vi.fn(),
	getAllProjectCredentials: vi.fn(),
}));

vi.mock('../../../src/config/configCache.js', () => ({
	configCache: {
		getConfig: vi.fn().mockReturnValue(null),
		getProjectByBoardId: vi.fn().mockReturnValue(null),
		getProjectByRepo: vi.fn().mockReturnValue(null),
		setConfig: vi.fn(),
		setProjectByBoardId: vi.fn(),
		setProjectByRepo: vi.fn(),
		invalidate: vi.fn(),
	},
}));

vi.mock('../../../src/router/config.js', () => ({
	routerConfig: {
		redisUrl: 'redis://localhost:6379',
		maxWorkers: 3,
		workerImage: 'test-worker:latest',
		workerMemoryMb: 512,
		workerTimeoutMs: 5000,
		dockerNetwork: 'test-network',
	},
}));

vi.mock('../../../src/router/job-data-offload.js', () => ({
	JOB_DATA_INLINE_MAX_BYTES: 96 * 1024,
	offloadJobData: vi.fn().mockResolvedValue(undefined),
	buildJobDataRedisKey: (jobId: string) => `cascade:jobdata:${jobId}`,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { findProjectByRepo, getAllProjectCredentials } from '../../../src/config/provider.js';
import { offloadJobData } from '../../../src/router/job-data-offload.js';
// All PM providers (Trello 006/2, JIRA 006/3, Linear 006/4) resolve through
// the PM provider manifest registry. Side-effect imports register them.
import '../../../src/integrations/pm/trello/index.js';
import '../../../src/integrations/pm/jira/index.js';
import '../../../src/integrations/pm/linear/index.js';
import type { CascadeJob } from '../../../src/router/queue.js';
import {
	buildWorkerEnv,
	buildWorkerEnvWithProjectId,
	extractAgentType,
	extractProjectIdFromJob,
	extractWorkItemId,
} from '../../../src/router/worker-env.js';

const mockFindProjectByRepo = vi.mocked(findProjectByRepo);
const mockGetAllProjectCredentials = vi.mocked(getAllProjectCredentials);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<{ id: string; data: CascadeJob }> = {}) {
	return {
		id: overrides.id ?? 'job-1',
		data: overrides.data ?? ({ type: 'trello', projectId: 'proj-1' } as CascadeJob),
	};
}

// ---------------------------------------------------------------------------
// extractProjectIdFromJob
// ---------------------------------------------------------------------------

describe('extractProjectIdFromJob', () => {
	it('returns projectId for trello jobs', async () => {
		const job = { type: 'trello', projectId: 'proj-trello' } as CascadeJob;
		expect(await extractProjectIdFromJob(job)).toBe('proj-trello');
	});

	it('returns projectId for jira jobs', async () => {
		const job = { type: 'jira', projectId: 'proj-jira' } as CascadeJob;
		expect(await extractProjectIdFromJob(job)).toBe('proj-jira');
	});

	it('returns projectId for sentry jobs', async () => {
		// Regression: prior to this branch, sentry jobs hit the `return null`
		// fall-through, so the worker-env builder skipped credential loading
		// entirely. The first real sentry-bound agent run in prod (cascade
		// project, 2026-05-06) crashed on boot with "CREDENTIAL_MASTER_KEY is
		// not set" because no CASCADE_CREDENTIAL_KEYS reached the worker.
		const job = {
			type: 'sentry',
			source: 'sentry',
			projectId: 'proj-sentry',
			eventType: 'event_alert',
			payload: {},
			receivedAt: '2026-05-06T12:48:09Z',
		} as unknown as CascadeJob;
		expect(await extractProjectIdFromJob(job)).toBe('proj-sentry');
	});

	it('returns projectId resolved from repo for github jobs', async () => {
		const job = { type: 'github', repoFullName: 'owner/repo' } as CascadeJob;
		mockFindProjectByRepo.mockResolvedValue({ id: 'proj-gh' } as never);
		expect(await extractProjectIdFromJob(job)).toBe('proj-gh');
	});

	it('returns null for github jobs with no repoFullName', async () => {
		const job = { type: 'github' } as CascadeJob;
		expect(await extractProjectIdFromJob(job)).toBeNull();
	});

	it('returns projectId for manual-run jobs', async () => {
		const job = { type: 'manual-run', projectId: 'proj-m' } as unknown as CascadeJob;
		expect(await extractProjectIdFromJob(job)).toBe('proj-m');
	});

	it('returns projectId for retry-run jobs', async () => {
		const job = { type: 'retry-run', projectId: 'proj-r' } as unknown as CascadeJob;
		expect(await extractProjectIdFromJob(job)).toBe('proj-r');
	});

	it('returns null for unknown job types', async () => {
		const job = { type: 'unknown' } as unknown as CascadeJob;
		expect(await extractProjectIdFromJob(job)).toBeNull();
	});

	it('returns projectId for debug-analysis jobs', async () => {
		const job = { type: 'debug-analysis', projectId: 'proj-da' } as unknown as CascadeJob;
		expect(await extractProjectIdFromJob(job)).toBe('proj-da');
	});
});

// ---------------------------------------------------------------------------
// buildWorkerEnv
// ---------------------------------------------------------------------------

describe('buildWorkerEnv', () => {
	beforeEach(() => {
		mockGetAllProjectCredentials.mockResolvedValue({ GITHUB_TOKEN: 'ghp_test' });
	});

	it('includes JOB_ID, JOB_TYPE, and JOB_DATA', async () => {
		const job = makeJob();
		const env = await buildWorkerEnv(job as never);
		expect(env).toContain('JOB_ID=job-1');
		expect(env).toContain('JOB_TYPE=trello');
		expect(env.some((e) => e.startsWith('JOB_DATA='))).toBe(true);
	});

	it('includes project credentials and CASCADE_CREDENTIAL_KEYS', async () => {
		const env = await buildWorkerEnv(makeJob() as never);
		expect(env).toContain('GITHUB_TOKEN=ghp_test');
		expect(env).toContain('CASCADE_CREDENTIAL_KEYS=GITHUB_TOKEN');
	});

	it('skips credential env vars if credential resolution fails', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockGetAllProjectCredentials.mockRejectedValue(new Error('DB error'));
		const env = await buildWorkerEnv(makeJob() as never);
		expect(env.some((e) => e.startsWith('CASCADE_CREDENTIAL_KEYS='))).toBe(false);
		warnSpy.mockRestore();
	});

	it('forwards SENTRY_DSN when set', async () => {
		process.env.SENTRY_DSN = 'https://sentry.example.com/1';
		const env = await buildWorkerEnv(makeJob() as never);
		expect(env).toContain('SENTRY_DSN=https://sentry.example.com/1');
		delete process.env.SENTRY_DSN;
	});

	it('forwards CASCADE_DASHBOARD_URL when set', async () => {
		process.env.CASCADE_DASHBOARD_URL = 'https://dev.cascade.example.com';
		try {
			const env = await buildWorkerEnv(makeJob() as never);
			expect(env).toContain('CASCADE_DASHBOARD_URL=https://dev.cascade.example.com');
		} finally {
			Reflect.deleteProperty(process.env, 'CASCADE_DASHBOARD_URL');
		}
	});

	it('omits CASCADE_DASHBOARD_URL when not set', async () => {
		Reflect.deleteProperty(process.env, 'CASCADE_DASHBOARD_URL');
		const env = await buildWorkerEnv(makeJob() as never);
		expect(env.some((e) => e.startsWith('CASCADE_DASHBOARD_URL='))).toBe(false);
	});

	it('includes REDIS_URL from routerConfig', async () => {
		const env = await buildWorkerEnv(makeJob() as never);
		expect(env).toContain('REDIS_URL=redis://localhost:6379');
	});

	it('forwards DATABASE_SSL when set', async () => {
		process.env.DATABASE_SSL = 'false';
		try {
			const env = await buildWorkerEnv(makeJob() as never);
			expect(env).toContain('DATABASE_SSL=false');
		} finally {
			Reflect.deleteProperty(process.env, 'DATABASE_SSL');
		}
	});

	it('omits DATABASE_SSL when not set', async () => {
		Reflect.deleteProperty(process.env, 'DATABASE_SSL');
		const env = await buildWorkerEnv(makeJob() as never);
		expect(env.some((e) => e.startsWith('DATABASE_SSL='))).toBe(false);
	});

	it('forwards DATABASE_CA_CERT when set', async () => {
		process.env.DATABASE_CA_CERT = '/etc/ssl/certs/rds-ca.pem';
		try {
			const env = await buildWorkerEnv(makeJob() as never);
			expect(env).toContain('DATABASE_CA_CERT=/etc/ssl/certs/rds-ca.pem');
		} finally {
			Reflect.deleteProperty(process.env, 'DATABASE_CA_CERT');
		}
	});
});

// ---------------------------------------------------------------------------
// extractWorkItemId
// ---------------------------------------------------------------------------

describe('extractWorkItemId', () => {
	it('returns workItemId for trello jobs', () => {
		const job = { type: 'trello', workItemId: 'card-1' } as CascadeJob;
		expect(extractWorkItemId(job)).toBe('card-1');
	});

	it('returns issueKey for jira jobs', () => {
		const job = { type: 'jira', issueKey: 'PROJ-123' } as unknown as CascadeJob;
		expect(extractWorkItemId(job)).toBe('PROJ-123');
	});

	it('returns triggerResult.workItemId for github jobs', () => {
		const job = {
			type: 'github',
			triggerResult: { workItemId: 'gh-wi-1' },
		} as unknown as CascadeJob;
		expect(extractWorkItemId(job)).toBe('gh-wi-1');
	});

	it('returns triggerResult.workItemId for linear jobs when present', () => {
		const job = {
			type: 'linear',
			workItemId: 'linear-issue-uuid',
			triggerResult: { workItemId: 'TEAM-123' },
		} as unknown as CascadeJob;
		expect(extractWorkItemId(job)).toBe('TEAM-123');
	});

	it('falls back to top-level workItemId for linear jobs without triggerResult work item', () => {
		const job = { type: 'linear', workItemId: 'linear-issue-uuid' } as unknown as CascadeJob;
		expect(extractWorkItemId(job)).toBe('linear-issue-uuid');
	});

	it('returns workItemId from dashboard jobs', () => {
		const job = { type: 'manual-run', workItemId: 'wi-dash' } as unknown as CascadeJob;
		expect(extractWorkItemId(job)).toBe('wi-dash');
	});

	it('returns undefined when no workItemId present', () => {
		const job = { type: 'github' } as CascadeJob;
		expect(extractWorkItemId(job)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// extractAgentType
// ---------------------------------------------------------------------------

describe('extractAgentType', () => {
	it('returns triggerResult.agentType when present', () => {
		const job = {
			type: 'github',
			triggerResult: { agentType: 'review' },
		} as unknown as CascadeJob;
		expect(extractAgentType(job)).toBe('review');
	});

	it('returns top-level agentType for dashboard jobs', () => {
		const job = { type: 'manual-run', agentType: 'implementation' } as unknown as CascadeJob;
		expect(extractAgentType(job)).toBe('implementation');
	});

	it('returns undefined when no agentType present', () => {
		const job = { type: 'trello' } as CascadeJob;
		expect(extractAgentType(job)).toBeUndefined();
	});

	it('prefers triggerResult.agentType over top-level agentType', () => {
		const job = {
			type: 'github',
			agentType: 'top-level',
			triggerResult: { agentType: 'nested' },
		} as unknown as CascadeJob;
		expect(extractAgentType(job)).toBe('nested');
	});
});

// ---------------------------------------------------------------------------
// buildWorkerEnvWithProjectId — snapshotReuse flag
// ---------------------------------------------------------------------------

describe('buildWorkerEnvWithProjectId — snapshotReuse flag', () => {
	beforeEach(() => {
		mockGetAllProjectCredentials.mockResolvedValue({});
	});

	it('does NOT include CASCADE_SNAPSHOT_REUSE when snapshotReuse=false (default)', async () => {
		const job = makeJob();
		const env = await buildWorkerEnvWithProjectId(job as never, 'proj-1');
		expect(env.some((e) => e.startsWith('CASCADE_SNAPSHOT_REUSE='))).toBe(false);
	});

	it('does NOT include CASCADE_SNAPSHOT_REUSE when snapshotReuse is omitted', async () => {
		const job = makeJob();
		const env = await buildWorkerEnvWithProjectId(job as never, 'proj-1');
		expect(env.some((e) => e.startsWith('CASCADE_SNAPSHOT_REUSE='))).toBe(false);
	});

	it('includes CASCADE_SNAPSHOT_REUSE=true when snapshotReuse=true', async () => {
		const job = makeJob();
		const env = await buildWorkerEnvWithProjectId(job as never, 'proj-1', true);
		expect(env).toContain('CASCADE_SNAPSHOT_REUSE=true');
	});

	it('still includes standard env vars alongside CASCADE_SNAPSHOT_REUSE', async () => {
		const job = makeJob();
		const env = await buildWorkerEnvWithProjectId(job as never, 'proj-1', true);
		expect(env).toContain('CASCADE_SNAPSHOT_REUSE=true');
		expect(env).toContain('JOB_ID=job-1');
		expect(env).toContain('REDIS_URL=redis://localhost:6379');
	});
});

// ---------------------------------------------------------------------------
// buildWorkerEnvWithProjectId — snapshotEnabled flag
// ---------------------------------------------------------------------------

describe('buildWorkerEnvWithProjectId — snapshotEnabled flag', () => {
	beforeEach(() => {
		mockGetAllProjectCredentials.mockResolvedValue({});
	});

	it('omits CASCADE_SNAPSHOT_ENABLED when snapshotEnabled=false (default)', async () => {
		const env = await buildWorkerEnvWithProjectId(makeJob() as never, 'proj-1');
		expect(env.some((e) => e.startsWith('CASCADE_SNAPSHOT_ENABLED='))).toBe(false);
	});

	it('includes CASCADE_SNAPSHOT_ENABLED=true when snapshotEnabled=true', async () => {
		const env = await buildWorkerEnvWithProjectId(makeJob() as never, 'proj-1', false, true);
		expect(env).toContain('CASCADE_SNAPSHOT_ENABLED=true');
	});

	it('can combine CASCADE_SNAPSHOT_REUSE and CASCADE_SNAPSHOT_ENABLED', async () => {
		const env = await buildWorkerEnvWithProjectId(makeJob() as never, 'proj-1', true, true);
		expect(env).toContain('CASCADE_SNAPSHOT_REUSE=true');
		expect(env).toContain('CASCADE_SNAPSHOT_ENABLED=true');
	});

	it('omits CASCADE_SNAPSHOT_ENABLED when snapshotReuse=true but snapshotEnabled=false', async () => {
		const env = await buildWorkerEnvWithProjectId(makeJob() as never, 'proj-1', true, false);
		expect(env).toContain('CASCADE_SNAPSHOT_REUSE=true');
		expect(env.some((e) => e.startsWith('CASCADE_SNAPSHOT_ENABLED='))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// buildWorkerEnvWithProjectId — large JOB_DATA offload (MNG-1660)
// ---------------------------------------------------------------------------

describe('buildWorkerEnvWithProjectId — JOB_DATA offload', () => {
	const mockOffload = vi.mocked(offloadJobData);

	beforeEach(() => {
		mockGetAllProjectCredentials.mockResolvedValue({});
		mockOffload.mockReset().mockResolvedValue(undefined);
	});

	function jobWithPayload(payload: unknown, id = 'job-big') {
		return { id, data: { type: 'linear', payload } as unknown as CascadeJob };
	}

	it('passes JOB_DATA inline and does NOT offload for a small payload', async () => {
		const env = await buildWorkerEnvWithProjectId(jobWithPayload({ small: 'x' }) as never, 'p');
		expect(env.some((e) => e.startsWith('JOB_DATA='))).toBe(true);
		expect(env.some((e) => e.startsWith('JOB_DATA_REDIS_KEY='))).toBe(false);
		expect(mockOffload).not.toHaveBeenCalled();
	});

	it('keeps a payload just under the threshold inline', async () => {
		// Build a payload whose JSON serialization is a few KB under 96 KiB.
		const description = 'a'.repeat(96 * 1024 - 2048);
		const env = await buildWorkerEnvWithProjectId(jobWithPayload({ description }) as never, 'p');
		expect(env.some((e) => e.startsWith('JOB_DATA='))).toBe(true);
		expect(mockOffload).not.toHaveBeenCalled();
	});

	it('offloads to Redis and emits JOB_DATA_REDIS_KEY (not JOB_DATA) for an oversized payload', async () => {
		const description = 'a'.repeat(200 * 1024); // ~200 KB → well over 96 KiB
		const env = await buildWorkerEnvWithProjectId(
			jobWithPayload({ description }, 'job-huge') as never,
			'p',
		);
		expect(mockOffload).toHaveBeenCalledTimes(1);
		expect(mockOffload).toHaveBeenCalledWith('job-huge', expect.any(String));
		expect(env).toContain('JOB_DATA_REDIS_KEY=cascade:jobdata:job-huge');
		expect(env.some((e) => e.startsWith('JOB_DATA='))).toBe(false);
	});

	it('measures the threshold in BYTES, not characters (multibyte payload)', async () => {
		// Each 😀 is 2 UTF-16 code units but 4 UTF-8 bytes. 30720 of them →
		// length 61440 (< 96 KiB) but byteLength 122880 (> 96 KiB) — proves
		// byteLength, not String.length, drives the decision.
		const description = '😀'.repeat(30 * 1024);
		expect(description.length).toBeLessThan(96 * 1024); // char count is under
		const env = await buildWorkerEnvWithProjectId(
			jobWithPayload({ description }, 'job-emoji') as never,
			'p',
		);
		expect(mockOffload).toHaveBeenCalledTimes(1);
		expect(env).toContain('JOB_DATA_REDIS_KEY=cascade:jobdata:job-emoji');
	});

	it('propagates a fail-loud error when the offload write rejects', async () => {
		mockOffload.mockRejectedValueOnce(new Error('Redis down'));
		const description = 'a'.repeat(200 * 1024);
		await expect(
			buildWorkerEnvWithProjectId(jobWithPayload({ description }) as never, 'p'),
		).rejects.toThrow('Redis down');
	});
});
