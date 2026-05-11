import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoggerInfo, mockLoadProjectConfig, mockGetSnapshot } = vi.hoisted(() => ({
	mockLoggerInfo: vi.fn(),
	mockLoadProjectConfig: vi.fn(),
	mockGetSnapshot: vi.fn(),
}));

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: (...args: unknown[]) => mockLoggerInfo(...args),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../src/router/config.js', () => ({
	loadProjectConfig: (...args: unknown[]) => mockLoadProjectConfig(...args),
	routerConfig: {
		workerImage: 'base-worker:latest',
		workerTimeoutMs: 30 * 60 * 1000,
		snapshotEnabled: false,
		snapshotDefaultTtlMs: 24 * 60 * 60 * 1000,
	},
}));

vi.mock('../../../src/router/snapshot-manager.js', () => ({
	getSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
}));

import {
	buildWorkerContainerName,
	ROUTER_KILL_BUFFER_MS,
	resolveSpawnSettings,
} from '../../../src/router/worker-spawn-settings.js';

describe('worker-spawn-settings', () => {
	beforeEach(() => {
		mockLoggerInfo.mockClear();
		mockLoadProjectConfig.mockReset();
		mockGetSnapshot.mockReset();
	});

	it('has no Docker dependency', async () => {
		const source = await readFile('src/router/worker-spawn-settings.ts', 'utf8');

		expect(source).not.toContain('dockerode');
		expect(source).not.toContain('new Docker');
	});

	it('returns global defaults without loading project config when projectId is null', async () => {
		const settings = await resolveSpawnSettings(null, undefined, 'job-no-project');

		expect(settings).toEqual({
			snapshotEnabled: false,
			workerImage: 'base-worker:latest',
			containerTimeoutMs: 30 * 60 * 1000,
			snapshotTtlMs: 24 * 60 * 60 * 1000,
		});
		expect(mockLoadProjectConfig).not.toHaveBeenCalled();
	});

	it('adds the router kill buffer to a per-project watchdog timeout', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'ucho',
					watchdogTimeoutMs: 45 * 60 * 1000,
					snapshotEnabled: false,
				},
			],
		});

		const settings = await resolveSpawnSettings('ucho', 'MNG-308', 'job-ucho-1');

		expect(ROUTER_KILL_BUFFER_MS).toBe(2 * 60 * 1000);
		expect(settings.containerTimeoutMs).toBe(47 * 60 * 1000);
		expect(mockLoggerInfo).toHaveBeenCalledWith(
			'[WorkerManager] Resolved spawn settings:',
			expect.objectContaining({
				jobId: 'job-ucho-1',
				projectId: 'ucho',
				workItemId: 'MNG-308',
				containerTimeoutMs: 47 * 60 * 1000,
				containerTimeoutMinutes: 47,
				projectWatchdogTimeoutMs: 45 * 60 * 1000,
				globalWorkerTimeoutMs: 30 * 60 * 1000,
			}),
		);
	});

	it('uses a valid snapshot image when project snapshots are enabled and metadata exists', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'snapshot-project',
					snapshotEnabled: true,
					snapshotTtlMs: 10_000,
				},
			],
		});
		mockGetSnapshot.mockReturnValue({
			imageName: 'cascade-snapshot-snapshot-project-mng-650:latest',
		});

		const settings = await resolveSpawnSettings('snapshot-project', 'MNG-650', 'job-snapshot');

		expect(mockGetSnapshot).toHaveBeenCalledWith('snapshot-project', 'MNG-650', 10_000);
		expect(settings).toMatchObject({
			snapshotEnabled: true,
			workerImage: 'cascade-snapshot-snapshot-project-mng-650:latest',
			snapshotTtlMs: 10_000,
		});
		expect(mockLoggerInfo).toHaveBeenCalledWith(
			'[WorkerManager] Snapshot hit — using snapshot image:',
			expect.objectContaining({
				jobId: 'job-snapshot',
				imageName: 'cascade-snapshot-snapshot-project-mng-650:latest',
			}),
		);
	});

	it('falls back to the base image when snapshots are enabled but no metadata exists', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [{ id: 'snapshot-miss', snapshotEnabled: true }],
		});
		mockGetSnapshot.mockReturnValue(undefined);

		const settings = await resolveSpawnSettings('snapshot-miss', 'MNG-651', 'job-miss');

		expect(settings.workerImage).toBe('base-worker:latest');
		expect(settings.snapshotEnabled).toBe(true);
		expect(mockLoggerInfo).toHaveBeenCalledWith(
			'[WorkerManager] Snapshot miss — using base worker image:',
			expect.objectContaining({
				jobId: 'job-miss',
				projectId: 'snapshot-miss',
				workItemId: 'MNG-651',
			}),
		);
	});

	it('builds Docker-safe worker container names from coalesced job IDs', () => {
		expect(buildWorkerContainerName('coalesce:ucho:MNG-413')).toBe(
			'cascade-worker-coalesce_ucho_MNG-413',
		);
	});

	it('passes through Docker-safe worker job IDs unchanged', () => {
		expect(buildWorkerContainerName('github-1234567890abcdef')).toBe(
			'cascade-worker-github-1234567890abcdef',
		);
	});
});
