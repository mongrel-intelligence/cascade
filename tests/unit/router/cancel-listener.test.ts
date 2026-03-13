import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockDockerListContainers, mockDockerGetContainer } = vi.hoisted(() => ({
	mockDockerListContainers: vi.fn(),
	mockDockerGetContainer: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('dockerode', () => ({
	default: vi.fn().mockImplementation(() => ({
		listContainers: mockDockerListContainers,
		getContainer: mockDockerGetContainer,
	})),
}));

const mockGetRunJobId = vi.fn();
vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	getRunJobId: (...args: unknown[]) => mockGetRunJobId(...args),
}));

const mockSubscribeToCancelCommands = vi.fn();
vi.mock('../../../src/queue/cancel.js', () => ({
	subscribeToCancelCommands: (...args: unknown[]) => mockSubscribeToCancelCommands(...args),
	publishCancelCommand: vi.fn().mockResolvedValue(undefined),
}));

const mockKillWorker = vi.fn();
vi.mock('../../../src/router/container-manager.js', () => ({
	killWorker: (...args: unknown[]) => mockKillWorker(...args),
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

import { startCancelListener, stopCancelListener } from '../../../src/router/cancel-listener.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cancel-listener', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('startCancelListener', () => {
		it('subscribes to cancel commands when REDIS_URL is set', async () => {
			process.env.REDIS_URL = 'redis://localhost:6379';
			vi.clearAllMocks(); // Ensure clean state
			await startCancelListener();

			expect(mockSubscribeToCancelCommands).toHaveBeenCalled();
		});

		it('kills worker when jobId is found in database', async () => {
			process.env.REDIS_URL = 'redis://localhost:6379';
			const handler = vi.fn();
			mockSubscribeToCancelCommands.mockImplementation(async (cb: unknown) => {
				handler.mockImplementation(cb);
			});

			await startCancelListener();

			mockGetRunJobId.mockResolvedValue('job-123');

			// Simulate receiving a cancel command
			await handler({ runId: 'run-123', reason: 'user requested' });

			expect(mockGetRunJobId).toHaveBeenCalledWith('run-123');
			expect(mockKillWorker).toHaveBeenCalledWith('job-123');
		});

		it('uses Docker fallback when jobId is not found in DB', async () => {
			process.env.REDIS_URL = 'redis://localhost:6379';
			const handler = vi.fn();
			mockSubscribeToCancelCommands.mockImplementation(async (cb: unknown) => {
				handler.mockImplementation(cb);
			});

			await startCancelListener();

			mockGetRunJobId.mockResolvedValue(null);
			mockDockerListContainers.mockResolvedValue([
				{
					Id: 'container-abc123',
					Labels: {
						'cascade.managed': 'true',
						'cascade.job.id': 'job-old',
					},
				},
			]);

			const mockStop = vi.fn().mockResolvedValue(undefined);
			mockDockerGetContainer.mockReturnValue({ stop: mockStop });

			// Simulate receiving a cancel command
			await handler({ runId: 'run-123', reason: 'timeout' });

			expect(mockDockerListContainers).toHaveBeenCalled();
			expect(mockDockerGetContainer).toHaveBeenCalledWith('container-abc123');
			expect(mockStop).toHaveBeenCalledWith({ t: 15 });
		});

		it('returns early if no cascade.managed containers exist', async () => {
			process.env.REDIS_URL = 'redis://localhost:6379';
			const handler = vi.fn();
			mockSubscribeToCancelCommands.mockImplementation(async (cb: unknown) => {
				handler.mockImplementation(cb);
			});

			await startCancelListener();

			mockGetRunJobId.mockResolvedValue(null);
			mockDockerListContainers.mockResolvedValue([
				{
					Id: 'container-other',
					Labels: {
						'cascade.managed': 'false',
					},
				},
			]);

			// Simulate receiving a cancel command
			await handler({ runId: 'run-123', reason: 'user requested' });

			expect(mockDockerGetContainer).not.toHaveBeenCalled();
		});

		it('handles errors in cancel handler gracefully', async () => {
			process.env.REDIS_URL = 'redis://localhost:6379';
			const handler = vi.fn();
			mockSubscribeToCancelCommands.mockImplementation(async (cb: unknown) => {
				handler.mockImplementation(cb);
			});

			await startCancelListener();

			mockGetRunJobId.mockRejectedValue(new Error('DB error'));

			// Should not throw
			await expect(handler({ runId: 'run-123', reason: 'user requested' })).resolves.not.toThrow();

			expect(mockKillWorker).not.toHaveBeenCalled();
		});

		it('handles Docker fallback errors gracefully', async () => {
			process.env.REDIS_URL = 'redis://localhost:6379';
			const handler = vi.fn();
			mockSubscribeToCancelCommands.mockImplementation(async (cb: unknown) => {
				handler.mockImplementation(cb);
			});

			await startCancelListener();

			mockGetRunJobId.mockResolvedValue(null);
			mockDockerListContainers.mockRejectedValue(new Error('Docker API error'));

			// Should not throw
			await expect(handler({ runId: 'run-123', reason: 'user requested' })).resolves.not.toThrow();
		});

		it('handles Docker container stop errors gracefully', async () => {
			process.env.REDIS_URL = 'redis://localhost:6379';
			const handler = vi.fn();
			mockSubscribeToCancelCommands.mockImplementation(async (cb: unknown) => {
				handler.mockImplementation(cb);
			});

			await startCancelListener();

			mockGetRunJobId.mockResolvedValue(null);
			mockDockerListContainers.mockResolvedValue([
				{
					Id: 'container-abc123',
					Labels: {
						'cascade.managed': 'true',
					},
				},
			]);

			const mockStop = vi.fn().mockRejectedValue(new Error('Container already stopped'));
			mockDockerGetContainer.mockReturnValue({ stop: mockStop });

			// Should not throw
			await expect(handler({ runId: 'run-123', reason: 'user requested' })).resolves.not.toThrow();
		});
	});

	describe('stopCancelListener', () => {
		it('can be called without error', async () => {
			await expect(stopCancelListener()).resolves.not.toThrow();
		});

		it('can be called multiple times without error', async () => {
			await stopCancelListener();
			await stopCancelListener();

			expect(true).toBe(true); // Just verify no errors
		});
	});
});
