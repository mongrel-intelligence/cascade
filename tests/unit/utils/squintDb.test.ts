import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
	createWriteStream: vi.fn(),
	unlinkSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
	stat: vi.fn(),
}));

vi.mock('node:stream/promises', () => ({
	pipeline: vi.fn().mockResolvedValue(undefined),
}));

import { createWriteStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolveSquintDbPath, setupRemoteSquintDb } from '../../../src/utils/squintDb.js';

const mockLog = {
	info: vi.fn(),
	warn: vi.fn(),
};

describe('squintDb', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe('resolveSquintDbPath', () => {
		it('returns SQUINT_DB_PATH when set and file exists', () => {
			process.env.SQUINT_DB_PATH = '/tmp/remote.db';
			vi.mocked(existsSync).mockImplementation((p) => p === '/tmp/remote.db');

			expect(resolveSquintDbPath('/repo')).toBe('/tmp/remote.db');
		});

		it('falls through to local .squint.db when SQUINT_DB_PATH file does not exist', () => {
			process.env.SQUINT_DB_PATH = '/tmp/missing.db';
			vi.mocked(existsSync).mockImplementation((p) => String(p) === '/repo/.squint.db');

			expect(resolveSquintDbPath('/repo')).toBe('/repo/.squint.db');
		});

		it('returns local .squint.db path when no env var set', () => {
			process.env.SQUINT_DB_PATH = undefined;
			vi.mocked(existsSync).mockImplementation((p) => String(p) === '/repo/.squint.db');

			expect(resolveSquintDbPath('/repo')).toBe('/repo/.squint.db');
		});

		it('returns null when neither exists', () => {
			process.env.SQUINT_DB_PATH = undefined;
			vi.mocked(existsSync).mockReturnValue(false);

			expect(resolveSquintDbPath('/repo')).toBeNull();
		});

		it('ignores SQUINT_DB_PATH when set but empty', () => {
			process.env.SQUINT_DB_PATH = '';
			vi.mocked(existsSync).mockReturnValue(false);

			expect(resolveSquintDbPath('/repo')).toBeNull();
		});
	});

	describe('setupRemoteSquintDb', () => {
		it('returns null when local .squint.db exists', async () => {
			vi.mocked(existsSync).mockImplementation((p) => String(p) === '/repo/.squint.db');

			const result = await setupRemoteSquintDb(
				'/repo',
				{ squintDbUrl: 'https://example.com/db' },
				mockLog,
			);

			expect(result).toBeNull();
		});

		it('returns null when no squintDbUrl configured', async () => {
			vi.mocked(existsSync).mockReturnValue(false);

			const result = await setupRemoteSquintDb('/repo', {}, mockLog);

			expect(result).toBeNull();
		});

		it('returns null when squintDbUrl is undefined', async () => {
			vi.mocked(existsSync).mockReturnValue(false);

			const result = await setupRemoteSquintDb('/repo', { squintDbUrl: undefined }, mockLog);

			expect(result).toBeNull();
		});

		it('downloads DB, sets SQUINT_DB_PATH, and returns cleanup fn', async () => {
			vi.mocked(existsSync).mockReturnValue(false);

			const mockWritable = {
				on: vi.fn(),
				write: vi.fn(),
				end: vi.fn(),
				once: vi.fn(),
				emit: vi.fn(),
			};
			vi.mocked(createWriteStream).mockReturnValue(
				mockWritable as unknown as ReturnType<typeof createWriteStream>,
			);
			vi.mocked(stat).mockResolvedValue({ size: 1024 } as Awaited<ReturnType<typeof stat>>);

			// Mock fetch
			const mockBody = new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array([1, 2, 3]));
					controller.close();
				},
			});
			const mockResponse = { ok: true, body: mockBody };
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

			const result = await setupRemoteSquintDb(
				'/repo',
				{ squintDbUrl: 'https://example.com/test.db' },
				mockLog,
			);

			expect(result).toBeTypeOf('function');
			expect(process.env.SQUINT_DB_PATH).toBeDefined();
			expect(process.env.SQUINT_DB_PATH).toMatch(/cascade-squint-.+\.db$/);
			expect(mockLog.info).toHaveBeenCalledWith(
				'Downloaded remote Squint DB',
				expect.objectContaining({
					url: 'https://example.com/test.db',
					sizeBytes: 1024,
				}),
			);

			// Call cleanup
			result?.();
			expect(process.env.SQUINT_DB_PATH).toBeUndefined();
		});

		it('returns null and logs warning on fetch failure', async () => {
			vi.mocked(existsSync).mockReturnValue(false);

			const mockResponse = { ok: false, status: 404 };
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

			const result = await setupRemoteSquintDb(
				'/repo',
				{ squintDbUrl: 'https://example.com/missing.db' },
				mockLog,
			);

			expect(result).toBeNull();
			expect(mockLog.warn).toHaveBeenCalledWith(
				'Failed to download remote Squint DB',
				expect.objectContaining({ status: 404 }),
			);
		});

		it('returns null and logs warning on network error', async () => {
			vi.mocked(existsSync).mockReturnValue(false);

			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

			const result = await setupRemoteSquintDb(
				'/repo',
				{ squintDbUrl: 'https://example.com/unreachable.db' },
				mockLog,
			);

			expect(result).toBeNull();
			expect(mockLog.warn).toHaveBeenCalledWith(
				'Failed to download remote Squint DB',
				expect.objectContaining({ error: 'Error: ECONNREFUSED' }),
			);
		});
	});
});
