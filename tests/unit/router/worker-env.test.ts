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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { findProjectByRepo, getAllProjectCredentials } from '../../../src/config/provider.js';
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
		process.env.SENTRY_DSN = undefined;
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
