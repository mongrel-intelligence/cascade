/**
 * Unit tests for src/queue/cancel.ts
 *
 * Tests Redis pub/sub publish and subscribe for cancel commands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks (must be set up before dynamic import) ──────────────────────────────

const mockPublish = vi.fn();
const mockSubscribe = vi.fn();

vi.mock('ioredis', () => {
	return {
		Redis: vi.fn().mockImplementation(() => ({
			publish: (...args: unknown[]) => mockPublish(...args),
			subscribe: (...args: unknown[]) => mockSubscribe(...args),
			on: vi.fn().mockReturnThis(),
		})),
	};
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Re-import the module freshly so each test suite starts with clean
 * publisher and subscriber singletons.
 */
async function freshImport() {
	vi.resetModules();

	vi.mock('ioredis', () => {
		return {
			Redis: vi.fn().mockImplementation(() => ({
				publish: (...args: unknown[]) => mockPublish(...args),
				subscribe: (...args: unknown[]) => mockSubscribe(...args),
				on: vi.fn().mockReturnThis(),
			})),
		};
	});

	return import('../../../src/queue/cancel.js');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('publishCancelCommand', () => {
	beforeEach(() => {
		vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
		mockPublish.mockResolvedValue(1); // 1 subscriber received the message
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it('publishes a cancel command as JSON to the cascade:cancel channel', async () => {
		const { publishCancelCommand } = await freshImport();

		await publishCancelCommand('run-123', 'user requested');

		expect(mockPublish).toHaveBeenCalledWith(
			'cascade:cancel',
			JSON.stringify({
				runId: 'run-123',
				reason: 'user requested',
			}),
		);
	});

	it('handles multiple cancel commands independently', async () => {
		const { publishCancelCommand } = await freshImport();

		await publishCancelCommand('run-1', 'reason-1');
		await publishCancelCommand('run-2', 'reason-2');

		expect(mockPublish).toHaveBeenCalledTimes(2);
		expect(mockPublish).toHaveBeenNthCalledWith(
			1,
			'cascade:cancel',
			JSON.stringify({ runId: 'run-1', reason: 'reason-1' }),
		);
		expect(mockPublish).toHaveBeenNthCalledWith(
			2,
			'cascade:cancel',
			JSON.stringify({ runId: 'run-2', reason: 'reason-2' }),
		);
	});

	it('throws an error when REDIS_URL is not set', async () => {
		const saved = process.env.REDIS_URL;
		// biome-ignore lint/performance/noDelete: need to fully remove the key
		delete process.env.REDIS_URL;

		try {
			const { publishCancelCommand } = await freshImport();
			await expect(publishCancelCommand('run-1', 'reason')).rejects.toThrow(
				'REDIS_URL is required',
			);
		} finally {
			if (saved !== undefined) {
				process.env.REDIS_URL = saved;
			}
		}
	});
});

describe('subscribeToCancelCommands', () => {
	beforeEach(() => {
		vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
		mockSubscribe.mockResolvedValue(1);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it('subscribes to the cascade:cancel channel', async () => {
		const { subscribeToCancelCommands } = await freshImport();
		const handler = vi.fn();

		await subscribeToCancelCommands(handler);

		expect(mockSubscribe).toHaveBeenCalledWith('cascade:cancel');
	});

	it('invokes handler callback when a cancel message is received', async () => {
		const { subscribeToCancelCommands } = await freshImport();
		const handler = vi.fn().mockResolvedValue(undefined);

		const { Redis } = await import('ioredis');
		const RedisMock = Redis as ReturnType<typeof vi.fn>;
		let onCallback: ((channel: string, message: string) => void) | null = null;

		RedisMock.mockImplementation(() => ({
			publish: vi.fn(),
			subscribe: vi.fn().mockResolvedValue(1),
			on: vi
				.fn()
				.mockImplementation((event: string, cb: (channel: string, message: string) => void) => {
					if (event === 'message') {
						onCallback = cb as (channel: string, message: string) => void;
					}
					return {
						publish: vi.fn(),
						subscribe: vi.fn(),
						on: vi.fn(),
					};
				}),
		}));

		await subscribeToCancelCommands(handler);

		// Simulate receiving a message
		if (onCallback) {
			onCallback('cascade:cancel', JSON.stringify({ runId: 'run-456', reason: 'timeout' }));

			// Wait for async handler to be called
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(handler).toHaveBeenCalledWith({
				runId: 'run-456',
				reason: 'timeout',
			});
		}
	});

	it('ignores messages from other channels', async () => {
		const { subscribeToCancelCommands } = await freshImport();
		const handler = vi.fn().mockResolvedValue(undefined);

		const { Redis } = await import('ioredis');
		const RedisMock = Redis as ReturnType<typeof vi.fn>;
		let onCallback: ((channel: string, message: string) => void) | null = null;

		RedisMock.mockImplementation(() => ({
			publish: vi.fn(),
			subscribe: vi.fn().mockResolvedValue(1),
			on: vi
				.fn()
				.mockImplementation((event: string, cb: (channel: string, message: string) => void) => {
					if (event === 'message') {
						onCallback = cb as (channel: string, message: string) => void;
					}
					return {
						publish: vi.fn(),
						subscribe: vi.fn(),
						on: vi.fn(),
					};
				}),
		}));

		await subscribeToCancelCommands(handler);

		// Simulate receiving a message from a different channel
		if (onCallback) {
			onCallback('other:channel', JSON.stringify({ data: 'something' }));

			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(handler).not.toHaveBeenCalled();
		}
	});

	it('handles JSON parse errors gracefully', async () => {
		const { subscribeToCancelCommands } = await freshImport();
		const handler = vi.fn().mockResolvedValue(undefined);

		const { Redis } = await import('ioredis');
		const RedisMock = Redis as ReturnType<typeof vi.fn>;
		let onCallback: ((channel: string, message: string) => void) | null = null;

		RedisMock.mockImplementation(() => ({
			publish: vi.fn(),
			subscribe: vi.fn().mockResolvedValue(1),
			on: vi
				.fn()
				.mockImplementation((event: string, cb: (channel: string, message: string) => void) => {
					if (event === 'message') {
						onCallback = cb as (channel: string, message: string) => void;
					}
					return {
						publish: vi.fn(),
						subscribe: vi.fn(),
						on: vi.fn(),
					};
				}),
		}));

		// Spy on console.error to verify error logging
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await subscribeToCancelCommands(handler);

		// Simulate receiving an invalid JSON message
		if (onCallback) {
			onCallback('cascade:cancel', 'invalid json {');

			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(handler).not.toHaveBeenCalled();
			expect(consoleSpy).toHaveBeenCalledWith(
				'[cancel] Failed to handle cancel command:',
				expect.any(Error),
			);
		}

		consoleSpy.mockRestore();
	});

	it('handles handler errors gracefully', async () => {
		const { subscribeToCancelCommands } = await freshImport();
		const handlerError = new Error('Handler failed');
		const handler = vi.fn().mockRejectedValue(handlerError);

		const { Redis } = await import('ioredis');
		const RedisMock = Redis as ReturnType<typeof vi.fn>;
		let onCallback: ((channel: string, message: string) => void) | null = null;

		RedisMock.mockImplementation(() => ({
			publish: vi.fn(),
			subscribe: vi.fn().mockResolvedValue(1),
			on: vi
				.fn()
				.mockImplementation((event: string, cb: (channel: string, message: string) => void) => {
					if (event === 'message') {
						onCallback = cb as (channel: string, message: string) => void;
					}
					return {
						publish: vi.fn(),
						subscribe: vi.fn(),
						on: vi.fn(),
					};
				}),
		}));

		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await subscribeToCancelCommands(handler);

		// Simulate receiving a message
		if (onCallback) {
			onCallback('cascade:cancel', JSON.stringify({ runId: 'run-789', reason: 'test' }));

			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(handler).toHaveBeenCalled();
			expect(consoleSpy).toHaveBeenCalledWith(
				'[cancel] Failed to handle cancel command:',
				handlerError,
			);
		}

		consoleSpy.mockRestore();
	});

	it('throws an error when REDIS_URL is not set', async () => {
		const saved = process.env.REDIS_URL;
		// biome-ignore lint/performance/noDelete: need to fully remove the key
		delete process.env.REDIS_URL;

		try {
			const { subscribeToCancelCommands } = await freshImport();
			const handler = vi.fn();
			await expect(subscribeToCancelCommands(handler)).rejects.toThrow('REDIS_URL is required');
		} finally {
			if (saved !== undefined) {
				process.env.REDIS_URL = saved;
			}
		}
	});
});
