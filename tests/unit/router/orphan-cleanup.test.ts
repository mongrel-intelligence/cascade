import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — vi.hoisted creates variables before vi.mock factories run
// ---------------------------------------------------------------------------

const { mockDockerGetContainer, mockDockerListContainers, mockFailOrphanedRunFallback } =
	vi.hoisted(() => ({
		mockDockerGetContainer: vi.fn(),
		mockDockerListContainers: vi.fn(),
		mockFailOrphanedRunFallback: vi.fn().mockResolvedValue(null),
	}));

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('dockerode', () => ({
	default: vi.fn().mockImplementation(() => ({
		getContainer: mockDockerGetContainer,
		listContainers: mockDockerListContainers,
	})),
}));

vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	failOrphanedRunFallback: (...args: unknown[]) => mockFailOrphanedRunFallback(...args),
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
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

// Mock active-workers to control which containers are "tracked"
const mockTrackedIds = new Set<string>();
vi.mock('../../../src/router/active-workers.js', () => ({
	getTrackedContainerIds: () => mockTrackedIds,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
	scanAndCleanupOrphans,
	startOrphanCleanup,
	stopOrphanCleanup,
} from '../../../src/router/orphan-cleanup.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('orphan-cleanup', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockDockerListContainers.mockResolvedValue([]);
		mockTrackedIds.clear();
		mockFailOrphanedRunFallback.mockClear();
		mockFailOrphanedRunFallback.mockResolvedValue(null);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		stopOrphanCleanup();
	});

	describe('startOrphanCleanup / stopOrphanCleanup', () => {
		it('starts a periodic orphan cleanup scan', () => {
			expect(() => startOrphanCleanup()).not.toThrow();
			stopOrphanCleanup();
		});

		it('stops the orphan cleanup scan', () => {
			startOrphanCleanup();
			expect(() => stopOrphanCleanup()).not.toThrow();
		});

		it('is a no-op to stop if not started', () => {
			expect(() => stopOrphanCleanup()).not.toThrow();
		});

		it('is idempotent on multiple starts', () => {
			startOrphanCleanup();
			expect(() => startOrphanCleanup()).not.toThrow();
			stopOrphanCleanup();
		});

		it('allows multiple start/stop cycles', () => {
			expect(() => {
				startOrphanCleanup();
				stopOrphanCleanup();
				startOrphanCleanup();
				stopOrphanCleanup();
			}).not.toThrow();
		});
	});

	describe('scanAndCleanupOrphans', () => {
		it('lists containers with cascade.managed=true label', async () => {
			mockDockerListContainers.mockResolvedValue([]);

			await scanAndCleanupOrphans();

			expect(mockDockerListContainers).toHaveBeenCalledWith(
				expect.objectContaining({
					all: false,
					filters: expect.objectContaining({
						label: expect.arrayContaining(['cascade.managed=true']),
					}),
				}),
			);
		});

		it('skips tracked containers', async () => {
			const trackedContainerId = 'container-abc123def456';
			mockTrackedIds.add(trackedContainerId);

			mockDockerListContainers.mockResolvedValue([
				{
					Id: trackedContainerId,
					Created: Math.floor(Date.now() / 1000) - 1000, // Very old
					State: 'running',
				} as never,
			]);

			await scanAndCleanupOrphans();

			// Container should NOT be stopped since it's tracked
			expect(mockDockerGetContainer).not.toHaveBeenCalled();
		});

		it('stops orphaned containers older than workerTimeoutMs', async () => {
			const orphanContainerId = 'orphan-container-old';
			const now = Math.floor(Date.now() / 1000);
			const createdAt = now - 6; // 6 seconds old, workerTimeoutMs is 5000ms

			const mockOrphanContainer = {
				stop: vi.fn().mockResolvedValue(undefined),
			};
			mockDockerListContainers.mockResolvedValue([
				{
					Id: orphanContainerId,
					Created: createdAt,
					State: 'running',
				} as never,
			]);
			mockDockerGetContainer.mockReturnValue(mockOrphanContainer as never);

			await scanAndCleanupOrphans();

			expect(mockOrphanContainer.stop).toHaveBeenCalledWith({ t: 15 });
		});

		it('leaves young orphaned containers alone', async () => {
			const youngContainerId = 'orphan-container-young';
			const now = Math.floor(Date.now() / 1000);
			const createdAt = now - 1; // 1 second old, workerTimeoutMs is 5000ms

			const mockYoungContainer = {
				stop: vi.fn(),
			};
			mockDockerListContainers.mockResolvedValue([
				{
					Id: youngContainerId,
					Created: createdAt,
					State: 'running',
				} as never,
			]);
			mockDockerGetContainer.mockReturnValue(mockYoungContainer as never);

			await scanAndCleanupOrphans();

			// Young container should NOT be stopped
			expect(mockYoungContainer.stop).not.toHaveBeenCalled();
		});

		it('handles Docker list errors', async () => {
			mockDockerListContainers.mockRejectedValue(new Error('Docker unavailable'));

			await expect(scanAndCleanupOrphans()).rejects.toThrow('Docker unavailable');
		});

		it('handles container stop errors gracefully', async () => {
			const orphanContainerId = 'orphan-stop-fails';
			const now = Math.floor(Date.now() / 1000);
			const createdAt = now - 6; // Old enough

			const mockFailContainer = {
				stop: vi.fn().mockRejectedValue(new Error('already stopped')),
			};
			mockDockerListContainers.mockResolvedValue([
				{
					Id: orphanContainerId,
					Created: createdAt,
					State: 'running',
				} as never,
			]);
			mockDockerGetContainer.mockReturnValue(mockFailContainer as never);

			// Should not throw, just log error
			await expect(scanAndCleanupOrphans()).resolves.toBeUndefined();
			expect(mockFailContainer.stop).toHaveBeenCalled();
		});

		it('stops multiple orphaned containers', async () => {
			const now = Math.floor(Date.now() / 1000);

			const mockContainer1 = {
				stop: vi.fn().mockResolvedValue(undefined),
			};
			const mockContainer2 = {
				stop: vi.fn().mockResolvedValue(undefined),
			};

			mockDockerListContainers.mockResolvedValue([
				{
					Id: 'orphan-1',
					Created: now - 6,
					State: 'running',
				} as never,
				{
					Id: 'orphan-2',
					Created: now - 10,
					State: 'running',
				} as never,
			]);

			mockDockerGetContainer.mockImplementation((id: string) => {
				if (id === 'orphan-1') return mockContainer1 as never;
				if (id === 'orphan-2') return mockContainer2 as never;
				return null;
			});

			await scanAndCleanupOrphans();

			expect(mockContainer1.stop).toHaveBeenCalledWith({ t: 15 });
			expect(mockContainer2.stop).toHaveBeenCalledWith({ t: 15 });
		});

		it('calls failOrphanedRunFallback when container has cascade.project.id label', async () => {
			const orphanContainerId = 'orphan-with-project';
			const now = Math.floor(Date.now() / 1000);
			const createdAt = now - 6; // old enough

			const mockOrphanContainer = {
				stop: vi.fn().mockResolvedValue(undefined),
			};
			mockDockerListContainers.mockResolvedValue([
				{
					Id: orphanContainerId,
					Created: createdAt,
					Labels: { 'cascade.project.id': 'proj-1' },
					State: 'running',
				} as never,
			]);
			mockDockerGetContainer.mockReturnValue(mockOrphanContainer as never);
			mockFailOrphanedRunFallback.mockResolvedValue('run-orphan-1');

			await scanAndCleanupOrphans();
			// Fire-and-forget — flush microtasks
			await new Promise((r) => setTimeout(r, 10));

			expect(mockFailOrphanedRunFallback).toHaveBeenCalledWith(
				'proj-1',
				undefined,
				expect.any(Date),
				'failed',
				'Orphan cleanup: container stopped',
				expect.any(Number),
			);
		});

		it('does NOT call failOrphanedRunFallback when container has no cascade.project.id label', async () => {
			const orphanContainerId = 'orphan-no-label';
			const now = Math.floor(Date.now() / 1000);
			const createdAt = now - 6;

			const mockOrphanContainer = {
				stop: vi.fn().mockResolvedValue(undefined),
			};
			mockDockerListContainers.mockResolvedValue([
				{
					Id: orphanContainerId,
					Created: createdAt,
					State: 'running',
				} as never,
			]);
			mockDockerGetContainer.mockReturnValue(mockOrphanContainer as never);

			await scanAndCleanupOrphans();
			await new Promise((r) => setTimeout(r, 10));

			expect(mockFailOrphanedRunFallback).not.toHaveBeenCalled();
		});

		it('does NOT call failOrphanedRunFallback when cascade.project.id label is empty string', async () => {
			const orphanContainerId = 'orphan-empty-label';
			const now = Math.floor(Date.now() / 1000);
			const createdAt = now - 6;

			const mockOrphanContainer = {
				stop: vi.fn().mockResolvedValue(undefined),
			};
			mockDockerListContainers.mockResolvedValue([
				{
					Id: orphanContainerId,
					Created: createdAt,
					Labels: { 'cascade.project.id': '' }, // empty → falsy
					State: 'running',
				} as never,
			]);
			mockDockerGetContainer.mockReturnValue(mockOrphanContainer as never);

			await scanAndCleanupOrphans();
			await new Promise((r) => setTimeout(r, 10));

			expect(mockFailOrphanedRunFallback).not.toHaveBeenCalled();
		});

		it('passes cascade.agent.type label as agentType to failOrphanedRunFallback', async () => {
			const orphanContainerId = 'orphan-with-agent-type';
			const now = Math.floor(Date.now() / 1000);
			const createdAt = now - 6;

			const mockOrphanContainer = {
				stop: vi.fn().mockResolvedValue(undefined),
			};
			mockDockerListContainers.mockResolvedValue([
				{
					Id: orphanContainerId,
					Created: createdAt,
					Labels: {
						'cascade.project.id': 'proj-2',
						'cascade.agent.type': 'review',
					},
					State: 'running',
				} as never,
			]);
			mockDockerGetContainer.mockReturnValue(mockOrphanContainer as never);
			mockFailOrphanedRunFallback.mockResolvedValue('run-agent-type');

			await scanAndCleanupOrphans();
			await new Promise((r) => setTimeout(r, 10));

			expect(mockFailOrphanedRunFallback).toHaveBeenCalledWith(
				'proj-2',
				'review',
				expect.any(Date),
				'failed',
				'Orphan cleanup: container stopped',
				expect.any(Number),
			);
		});

		it('passes undefined agentType when cascade.agent.type label is empty or absent', async () => {
			const orphanContainerId = 'orphan-no-agent-type';
			const now = Math.floor(Date.now() / 1000);
			const createdAt = now - 6;

			const mockOrphanContainer = {
				stop: vi.fn().mockResolvedValue(undefined),
			};
			mockDockerListContainers.mockResolvedValue([
				{
					Id: orphanContainerId,
					Created: createdAt,
					Labels: { 'cascade.project.id': 'proj-3', 'cascade.agent.type': '' },
					State: 'running',
				} as never,
			]);
			mockDockerGetContainer.mockReturnValue(mockOrphanContainer as never);
			mockFailOrphanedRunFallback.mockResolvedValue(null);

			await scanAndCleanupOrphans();
			await new Promise((r) => setTimeout(r, 10));

			expect(mockFailOrphanedRunFallback).toHaveBeenCalledWith(
				'proj-3',
				undefined, // empty string coerced to undefined
				expect.any(Date),
				'failed',
				'Orphan cleanup: container stopped',
				expect.any(Number),
			);
		});

		it('stops orphans but leaves tracked and young containers', async () => {
			const trackedId = 'container-tracked-123';
			mockTrackedIds.add(trackedId);

			const now = Math.floor(Date.now() / 1000);
			const mockedOrphanContainer = {
				stop: vi.fn().mockResolvedValue(undefined),
			};
			const mockedYoungContainer = {
				stop: vi.fn().mockResolvedValue(undefined),
			};

			mockDockerListContainers.mockResolvedValue([
				{
					Id: trackedId, // tracked — should be skipped
					Created: now - 10,
					State: 'running',
				} as never,
				{
					Id: 'orphan-old',
					Created: now - 6,
					State: 'running',
				} as never,
				{
					Id: 'orphan-young',
					Created: now - 1,
					State: 'running',
				} as never,
			]);

			mockDockerGetContainer.mockImplementation((id: string) => {
				if (id === 'orphan-old') return mockedOrphanContainer as never;
				if (id === 'orphan-young') return mockedYoungContainer as never;
				return { stop: vi.fn() } as never;
			});

			await scanAndCleanupOrphans();

			// Only the old orphan should be stopped
			expect(mockedOrphanContainer.stop).toHaveBeenCalledWith({ t: 15 });
			expect(mockedYoungContainer.stop).not.toHaveBeenCalled();
		});
	});
});
