/**
 * Log-hygiene integration tests.
 *
 * Plain-text credential values must never appear in server stdout/stderr — not
 * on the happy-path credential save, not on a successful integration upsert,
 * not even on the error path when an upsert fails. Captures `console.log`
 * and `console.error` around each operation and asserts the sentinel value
 * never leaks into the captured output.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDashboardErrorLog, formatTRPCErrorLog } from '../../../src/api/errorLogging.js';
import { writeProjectCredential } from '../../../src/db/repositories/credentialsRepository.js';
import { upsertProjectIntegration } from '../../../src/db/repositories/integrationsRepository.js';
import { truncateAll } from '../helpers/db.js';
import { seedOrg, seedProject } from '../helpers/seed.js';

const SECRET_SENTINEL = 'lin_wh_SECRET_SENTINEL_do_not_log';

describe('log hygiene — plaintext credentials never appear in server logs', () => {
	let logs: string[];
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errSpy: ReturnType<typeof vi.spyOn>;
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		await truncateAll();
		await seedOrg();
		await seedProject();

		logs = [];
		const capture = (...args: unknown[]) => {
			try {
				logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
			} catch {
				logs.push(args.map(String).join(' '));
			}
		};
		logSpy = vi.spyOn(console, 'log').mockImplementation(capture);
		errSpy = vi.spyOn(console, 'error').mockImplementation(capture);
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(capture);
	});

	afterEach(() => {
		logSpy.mockRestore();
		errSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it('credential save path does not log the plaintext value', async () => {
		await writeProjectCredential('test-project', 'LINEAR_WEBHOOK_SECRET', SECRET_SENTINEL);

		const joined = logs.join('\n');
		expect(joined).not.toContain(SECRET_SENTINEL);
	});

	it('successful integration upsert does not log the config payload verbatim', async () => {
		// Even benign config shouldn't flood logs — assert the upsert runs quietly.
		await upsertProjectIntegration('test-project', 'pm', 'linear', {
			teamId: 'team-123',
			statuses: { backlog: 'Backlog' },
			labels: {},
		});

		const errLogs = logs.filter((l) => /config/i.test(l) && /team-123/.test(l));
		expect(errLogs).toEqual([]);
	});

	it('failing upsert (bad projectId FK) does not leak any stored credential value into the error log', async () => {
		await writeProjectCredential('test-project', 'LINEAR_WEBHOOK_SECRET', SECRET_SENTINEL);

		// FK violation — project 'nonexistent-project' does not exist.
		let caught: unknown;
		try {
			await upsertProjectIntegration('nonexistent-project', 'pm', 'linear', {
				teamId: 'team-xyz',
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeDefined();

		// Simulate what app.onError / the tRPC errorFormatter would log.
		const dashboardPayload = formatDashboardErrorLog(caught, {
			path: '/trpc/projects.integrations.upsert',
			method: 'POST',
		});
		console.error('Unhandled error', dashboardPayload);

		const joined = logs.join('\n');
		expect(joined).not.toContain(SECRET_SENTINEL);
		// But the log DID capture the real PG error (diagnosability).
		expect(joined).toMatch(/23503|foreign key|project_integrations_project_id_fkey/);
	});

	it('tRPC error log formatter output does not contain credential values', async () => {
		await writeProjectCredential('test-project', 'LINEAR_WEBHOOK_SECRET', SECRET_SENTINEL);

		let caught: unknown;
		try {
			await upsertProjectIntegration('nonexistent-project', 'pm', 'linear', {});
		} catch (e) {
			caught = e;
		}

		const payload = formatTRPCErrorLog({
			error: {
				code: 'INTERNAL_SERVER_ERROR',
				message: (caught as Error).message,
				cause: caught,
				name: 'TRPCError',
				stack: (caught as Error).stack,
			} as unknown as import('@trpc/server').TRPCError,
			path: 'projects.integrations.upsert',
			type: 'mutation',
		});
		const serialized = JSON.stringify(payload);
		expect(serialized).not.toContain(SECRET_SENTINEL);
	});
});
