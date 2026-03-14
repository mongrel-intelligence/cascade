import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockGetRunJobId = vi.fn();
vi.mock('../../../src/db/repositories/runsRepository.js', () => ({
	getRunJobId: (...args: unknown[]) => mockGetRunJobId(...args),
}));

const mockSubscribeToCancelCommands = vi.fn();
const mockUnsubscribeFromCancelCommands = vi.fn();
vi.mock('../../../src/queue/cancel.js', () => ({
	subscribeToCancelCommands: (...args: unknown[]) => mockSubscribeToCancelCommands(...args),
	unsubscribeFromCancelCommands: (...args: unknown[]) => mockUnsubscribeFromCancelCommands(...args),
	publishCancelCommand: vi.fn().mockResolvedValue(undefined),
}));

const mockKillWorker = vi.fn();
vi.mock('../../../src/router/container-manager.js', () => ({
	killWorker: (...args: unknown[]) => mockKillWorker(...args),
}));

const { mockLogger } = vi.hoisted(() => ({
	mockLogger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));
vi.mock('../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { startCancelListener, stopCancelListener } from '../../../src/router/cancel-listener.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cancel-listener', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		// Reset module-level cancelSubscriberActive flag by stopping the listener
		// (no-op if not active, safe to call always)
		mockUnsubscribeFromCancelCommands.mockResolvedValue(undefined);
		await stopCancelListener();
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

		it('logs a warning and does not kill any container when jobId is not found in DB', async () => {
			process.env.REDIS_URL = 'redis://localhost:6379';
			const handler = vi.fn();
			mockSubscribeToCancelCommands.mockImplementation(async (cb: unknown) => {
				handler.mockImplementation(cb);
			});

			await startCancelListener();

			mockGetRunJobId.mockResolvedValue(null);

			// Simulate receiving a cancel command
			await handler({ runId: 'run-123', reason: 'timeout' });

			expect(mockKillWorker).not.toHaveBeenCalled();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('JobId not found in DB for run'),
				expect.objectContaining({ runId: 'run-123' }),
			);
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
	});

	describe('stopCancelListener', () => {
		it('can be called without error when not active', async () => {
			await expect(stopCancelListener()).resolves.not.toThrow();
			expect(mockUnsubscribeFromCancelCommands).not.toHaveBeenCalled();
		});

		it('calls unsubscribeFromCancelCommands when active', async () => {
			process.env.REDIS_URL = 'redis://localhost:6379';
			await startCancelListener();

			mockUnsubscribeFromCancelCommands.mockResolvedValue(undefined);
			await stopCancelListener();

			expect(mockUnsubscribeFromCancelCommands).toHaveBeenCalled();
		});

		it('can be called multiple times without error', async () => {
			process.env.REDIS_URL = 'redis://localhost:6379';
			await startCancelListener();

			mockUnsubscribeFromCancelCommands.mockResolvedValue(undefined);
			await stopCancelListener();
			await stopCancelListener(); // Second call is a no-op

			// unsubscribe should only have been called once (second call is no-op)
			expect(mockUnsubscribeFromCancelCommands).toHaveBeenCalledTimes(1);
		});
	});
});
