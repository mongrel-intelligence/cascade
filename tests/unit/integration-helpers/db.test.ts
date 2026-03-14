import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:net before importing the module under test
vi.mock('node:net', () => ({
	default: {
		connect: vi.fn(),
	},
}));

vi.mock('node:child_process', () => ({
	execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import net from 'node:net';
import { resolveTestDbUrl } from '../../integration/helpers/db.js';

// Helper to create a mock socket that emits a given event
function makeMockSocket(event: 'connect' | 'error' | 'timeout') {
	const listeners: Record<string, (() => void)[]> = {};
	const socket = {
		once: (ev: string, cb: () => void) => {
			listeners[ev] = listeners[ev] ?? [];
			listeners[ev].push(cb);
		},
		setTimeout: (_ms: number, cb: () => void) => {
			if (event === 'timeout') setImmediate(cb);
		},
		destroy: vi.fn(),
		emit: (ev: string) => {
			for (const cb of listeners[ev] ?? []) cb();
		},
	};

	// Trigger the relevant event asynchronously
	if (event === 'connect' || event === 'error') {
		setImmediate(() => socket.emit(event));
	}

	return socket;
}

describe('resolveTestDbUrl', () => {
	beforeEach(() => {
		vi.mocked(net.connect).mockReset();
		vi.mocked(execSync).mockReset();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	describe('TEST_DATABASE_URL env var', () => {
		it('returns TEST_DATABASE_URL when the host:port is reachable', async () => {
			vi.stubEnv('TEST_DATABASE_URL', 'postgresql://user:pass@myhost:5432/mydb');
			vi.mocked(net.connect).mockReturnValue(makeMockSocket('connect') as never);

			const result = await resolveTestDbUrl();

			expect(result).toBe('postgresql://user:pass@myhost:5432/mydb');
			// Should have probed myhost:5432
			expect(net.connect).toHaveBeenCalledWith(
				expect.objectContaining({ host: 'myhost', port: 5432 }),
			);
		});

		it('falls through when TEST_DATABASE_URL host is not reachable', async () => {
			vi.stubEnv('TEST_DATABASE_URL', 'postgresql://user:pass@unreachable:5432/mydb');
			// First call (env-var probe) → error; second call (localhost:5433 probe) → error
			vi.mocked(net.connect)
				.mockReturnValueOnce(makeMockSocket('error') as never)
				.mockReturnValueOnce(makeMockSocket('error') as never);
			vi.mocked(execSync).mockReturnValue('' as never); // no container IP

			const result = await resolveTestDbUrl();

			expect(result).toBeNull();
		});

		it('falls through when TEST_DATABASE_URL is malformed', async () => {
			vi.stubEnv('TEST_DATABASE_URL', 'not-a-valid-url');
			// localhost:5433 probe → error
			vi.mocked(net.connect).mockReturnValue(makeMockSocket('error') as never);
			vi.mocked(execSync).mockReturnValue('' as never);

			const result = await resolveTestDbUrl();

			expect(result).toBeNull();
		});

		it('defaults port to 5432 when TEST_DATABASE_URL has no explicit port', async () => {
			vi.stubEnv('TEST_DATABASE_URL', 'postgresql://user:pass@myhost/mydb');
			vi.mocked(net.connect).mockReturnValue(makeMockSocket('connect') as never);

			const result = await resolveTestDbUrl();

			expect(result).toBe('postgresql://user:pass@myhost/mydb');
			expect(net.connect).toHaveBeenCalledWith(
				expect.objectContaining({ host: 'myhost', port: 5432 }),
			);
		});
	});

	describe('localhost:5433 fallback (standard Docker / CI)', () => {
		it('returns the standard Docker URL when localhost:5433 is reachable', async () => {
			vi.stubEnv('TEST_DATABASE_URL', '');
			// env var probe skipped (empty string is falsy after stubEnv removes it)
			vi.mocked(net.connect).mockReturnValue(makeMockSocket('connect') as never);

			const result = await resolveTestDbUrl();

			expect(result).toBe('postgresql://cascade_test:cascade_test@127.0.0.1:5433/cascade_test');
		});

		it('probes 127.0.0.1:5433 for the Docker fallback', async () => {
			vi.stubEnv('TEST_DATABASE_URL', '');
			vi.mocked(net.connect).mockReturnValue(makeMockSocket('connect') as never);

			await resolveTestDbUrl();

			expect(net.connect).toHaveBeenCalledWith(
				expect.objectContaining({ host: '127.0.0.1', port: 5433 }),
			);
		});
	});

	describe('container bridge IP fallback (rootless Docker)', () => {
		it('returns bridge-IP URL when localhost:5433 is not reachable but container IP is', async () => {
			vi.stubEnv('TEST_DATABASE_URL', '');
			// localhost:5433 → not reachable; bridge IP → reachable
			vi.mocked(net.connect)
				.mockReturnValueOnce(makeMockSocket('error') as never) // 127.0.0.1:5433
				.mockReturnValueOnce(makeMockSocket('connect') as never); // 172.20.0.2:5432
			vi.mocked(execSync).mockReturnValue('172.20.0.2\n' as never);

			const result = await resolveTestDbUrl();

			expect(result).toBe('postgresql://cascade_test:cascade_test@172.20.0.2:5432/cascade_test');
		});

		it('calls docker inspect with the expected container name', async () => {
			vi.stubEnv('TEST_DATABASE_URL', '');
			vi.mocked(net.connect)
				.mockReturnValueOnce(makeMockSocket('error') as never)
				.mockReturnValueOnce(makeMockSocket('connect') as never);
			vi.mocked(execSync).mockReturnValue('172.20.0.2' as never);

			await resolveTestDbUrl();

			expect(execSync).toHaveBeenCalledWith(
				expect.stringContaining('cascade-postgres-test'),
				expect.any(Object),
			);
		});

		it('skips the bridge-IP probe when docker inspect returns empty', async () => {
			vi.stubEnv('TEST_DATABASE_URL', '');
			vi.mocked(net.connect).mockReturnValue(makeMockSocket('error') as never);
			vi.mocked(execSync).mockReturnValue('' as never);

			const result = await resolveTestDbUrl();

			expect(result).toBeNull();
		});

		it('skips the bridge-IP probe when docker inspect throws', async () => {
			vi.stubEnv('TEST_DATABASE_URL', '');
			vi.mocked(net.connect).mockReturnValue(makeMockSocket('error') as never);
			vi.mocked(execSync).mockImplementation(() => {
				throw new Error('docker not found');
			});

			const result = await resolveTestDbUrl();

			expect(result).toBeNull();
		});
	});

	describe('no database reachable', () => {
		it('returns null when all probes fail', async () => {
			vi.stubEnv('TEST_DATABASE_URL', '');
			vi.mocked(net.connect).mockReturnValue(makeMockSocket('error') as never);
			vi.mocked(execSync).mockReturnValue('' as never);

			const result = await resolveTestDbUrl();

			expect(result).toBeNull();
		});
	});
});
