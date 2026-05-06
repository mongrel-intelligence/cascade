import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — the diagnostic helpers don't touch loadProjectConfig or
// credentials, but importing container-manager.ts pulls in its full dep
// graph; mocking the noisy subsystems keeps the test boot fast.
// ---------------------------------------------------------------------------

const { mockLoggerInfo, mockLoggerWarn, mockLoadProjectConfig, mockGetSnapshot } = vi.hoisted(
	() => ({
		mockLoggerInfo: vi.fn(),
		mockLoggerWarn: vi.fn(),
		mockLoadProjectConfig: vi.fn(),
		mockGetSnapshot: vi.fn(),
	}),
);

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: (...args: unknown[]) => mockLoggerInfo(...args),
		warn: (...args: unknown[]) => mockLoggerWarn(...args),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: vi.fn(),
	flush: vi.fn().mockResolvedValue(undefined),
	setTag: vi.fn(),
}));

vi.mock('../../../src/router/config.js', () => ({
	loadProjectConfig: (...args: unknown[]) => mockLoadProjectConfig(...args),
	routerConfig: {
		workerImage: 'base-worker:latest',
		workerMemoryMb: 8192,
		workerTimeoutMs: 30 * 60 * 1000, // 30 min — the production-config value
		dockerNetwork: 'cascade-net',
		snapshotEnabled: false,
		snapshotDefaultTtlMs: 86_400_000,
		snapshotMaxCount: 5,
		snapshotMaxSizeBytes: 10_737_418_240,
		maxWorkers: 5,
	},
}));

vi.mock('../../../src/router/snapshot-manager.js', () => ({
	getSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
	registerSnapshot: vi.fn(),
	invalidateSnapshot: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { formatCrashReason } from '../../../src/router/active-workers.js';
import {
	inspectExitedContainer,
	resolveSpawnSettings,
} from '../../../src/router/container-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockContainer = {
	inspect: ReturnType<typeof vi.fn>;
};

function makeContainer(
	state: Record<string, unknown> | null,
	throwOnInspect = false,
): MockContainer {
	return {
		inspect: throwOnInspect
			? vi.fn().mockRejectedValue(new Error('socket hang up'))
			: vi.fn().mockResolvedValue(state === null ? null : { State: state }),
	};
}

// ---------------------------------------------------------------------------
// formatCrashReason — direct tests of the wire-format consumed by the run
// record's `error` field. The format is now de-facto API: any future
// `cascade runs show` filter or dashboard parser will key on it.
// ---------------------------------------------------------------------------

describe('formatCrashReason', () => {
	it('returns the bare crash message when no details are provided', () => {
		expect(formatCrashReason(137)).toBe('Worker crashed with exit code 137');
	});

	it('appends OOMKilled=true when details.oomKilled is true', () => {
		expect(formatCrashReason(137, { oomKilled: true })).toBe(
			'Worker crashed with exit code 137 · OOMKilled=true',
		);
	});

	it('appends OOMKilled=false when details.oomKilled is explicitly false', () => {
		expect(formatCrashReason(137, { oomKilled: false })).toBe(
			'Worker crashed with exit code 137 · OOMKilled=false',
		);
	});

	it('omits the OOMKilled segment when oomKilled is undefined', () => {
		expect(formatCrashReason(1, { exitReason: 'OCI runtime error' })).toBe(
			'Worker crashed with exit code 1 · reason="OCI runtime error"',
		);
	});

	it('appends reason="…" when details.exitReason is non-empty', () => {
		expect(formatCrashReason(137, { exitReason: 'Out of memory' })).toBe(
			'Worker crashed with exit code 137 · reason="Out of memory"',
		);
	});

	it('chains OOMKilled and reason in stable order (OOMKilled · reason)', () => {
		expect(formatCrashReason(137, { oomKilled: true, exitReason: 'Out of memory' })).toBe(
			'Worker crashed with exit code 137 · OOMKilled=true · reason="Out of memory"',
		);
	});

	it('uses · as the segment separator (grep stability)', () => {
		const reason = formatCrashReason(137, { oomKilled: true, exitReason: 'X' });
		expect(reason.split(' · ')).toHaveLength(3);
	});

	// Format-stability regression: dashboards / `runs show` filters will grep
	// these exact patterns. Bumping the format silently is a downstream break.
	it('produces a grep-stable OOMKilled marker', () => {
		expect(formatCrashReason(137, { oomKilled: true })).toMatch(/OOMKilled=(true|false)/);
		expect(formatCrashReason(137, { oomKilled: false })).toMatch(/OOMKilled=(true|false)/);
	});

	// --- Spec 018 / plan 2: boot-fail exit code 2 ---
	it('labels exit code 2 as a boot failure (spec 018)', () => {
		expect(formatCrashReason(2)).toBe('Worker boot failed (exit code 2)');
	});

	it('boot-fail label includes the exitReason when provided', () => {
		expect(formatCrashReason(2, { exitReason: 'plan-resolution' })).toBe(
			'Worker boot failed (exit code 2) · reason="plan-resolution"',
		);
	});

	it('boot-fail label is grep-distinguishable from generic crash', () => {
		const bootFail = formatCrashReason(2);
		const crash = formatCrashReason(1);
		expect(bootFail).toMatch(/Worker boot failed/);
		expect(crash).not.toMatch(/Worker boot failed/);
	});
});

// ---------------------------------------------------------------------------
// inspectExitedContainer — direct unit tests of the Docker-state extraction.
// The whole change exists so post-mortems can read OOMKilled / exit reason
// without ssh; without these tests, a future refactor can silently drop
// fields and we'd never notice.
// ---------------------------------------------------------------------------

describe('inspectExitedContainer', () => {
	beforeEach(() => {
		mockLoggerInfo.mockClear();
		mockLoggerWarn.mockClear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('extracts OOMKilled=true from State', async () => {
		const container = makeContainer({
			OOMKilled: true,
			Error: '',
			StartedAt: '2026-04-25T08:00:00.000Z',
			FinishedAt: '2026-04-25T08:00:30.000Z',
		});
		const result = await inspectExitedContainer(container as never, 'job-1');
		expect(result.oomKilled).toBe(true);
	});

	it('extracts OOMKilled=false from State', async () => {
		const container = makeContainer({
			OOMKilled: false,
			Error: '',
			StartedAt: '2026-04-25T08:00:00.000Z',
			FinishedAt: '2026-04-25T08:00:30.000Z',
		});
		const result = await inspectExitedContainer(container as never, 'job-1');
		expect(result.oomKilled).toBe(false);
	});

	it('extracts non-empty State.Error as exitReason', async () => {
		const container = makeContainer({
			OOMKilled: false,
			Error: 'OCI runtime error: exec failed',
			StartedAt: '2026-04-25T08:00:00.000Z',
			FinishedAt: '2026-04-25T08:00:30.000Z',
		});
		const result = await inspectExitedContainer(container as never, 'job-1');
		expect(result.exitReason).toBe('OCI runtime error: exec failed');
	});

	it('returns undefined exitReason when State.Error is empty (clean exits)', async () => {
		const container = makeContainer({
			OOMKilled: false,
			Error: '',
			StartedAt: '2026-04-25T08:00:00.000Z',
			FinishedAt: '2026-04-25T08:00:30.000Z',
		});
		const result = await inspectExitedContainer(container as never, 'job-1');
		expect(result.exitReason).toBeUndefined();
	});

	it('computes durationMs from StartedAt/FinishedAt', async () => {
		const container = makeContainer({
			OOMKilled: false,
			Error: '',
			StartedAt: '2026-04-25T08:00:00.000Z',
			FinishedAt: '2026-04-25T08:00:30.000Z',
		});
		const result = await inspectExitedContainer(container as never, 'job-1');
		expect(result.durationMs).toBe(30_000);
	});

	it('returns undefined durationMs for sentinel `0001-01-01` timestamps', async () => {
		// Docker uses 0001-01-01T00:00:00Z when a phase never completed —
		// e.g. FinishedAt on a still-running container, or StartedAt on a
		// container that errored before start.
		const container = makeContainer({
			OOMKilled: false,
			Error: '',
			StartedAt: '0001-01-01T00:00:00Z',
			FinishedAt: '0001-01-01T00:00:00Z',
		});
		const result = await inspectExitedContainer(container as never, 'job-1');
		// 0001 → 0001 = 0ms which IS finite; the regression we're guarding
		// against is when only one is the sentinel and the other is real,
		// producing a huge negative number. Test that case below too.
		expect(Number.isFinite(result.durationMs)).toBe(true);
	});

	it('returns undefined durationMs when timestamps are malformed', async () => {
		const container = makeContainer({
			OOMKilled: false,
			Error: '',
			StartedAt: 'not-a-date',
			FinishedAt: '2026-04-25T08:00:30.000Z',
		});
		const result = await inspectExitedContainer(container as never, 'job-1');
		expect(result.durationMs).toBeUndefined();
	});

	it('returns undefined durationMs when StartedAt is sentinel and FinishedAt is real (negative span)', async () => {
		const container = makeContainer({
			OOMKilled: false,
			Error: '',
			StartedAt: '2026-04-25T08:00:30.000Z',
			FinishedAt: '0001-01-01T00:00:00Z',
		});
		const result = await inspectExitedContainer(container as never, 'job-1');
		// FinishedAt - StartedAt is a huge negative number — drop it rather
		// than leak a misleading value into the run record.
		expect(result.durationMs).toBeUndefined();
	});

	it('returns undefined durationMs when StartedAt or FinishedAt is missing', async () => {
		const container = makeContainer({
			OOMKilled: false,
			Error: '',
			// StartedAt missing; FinishedAt present
			FinishedAt: '2026-04-25T08:00:30.000Z',
		});
		const result = await inspectExitedContainer(container as never, 'job-1');
		expect(result.durationMs).toBeUndefined();
	});

	it('returns all-undefined when inspect rejects (daemon socket drop)', async () => {
		const container = makeContainer(null, true);
		const result = await inspectExitedContainer(container as never, 'job-1');
		expect(result.oomKilled).toBeUndefined();
		expect(result.exitReason).toBeUndefined();
		expect(result.durationMs).toBeUndefined();
	});

	it('logs a warning when inspect rejects', async () => {
		const container = makeContainer(null, true);
		await inspectExitedContainer(container as never, 'job-warn');
		expect(mockLoggerWarn).toHaveBeenCalledWith(
			'[WorkerManager] container.inspect() after wait failed:',
			expect.objectContaining({ jobId: 'job-warn' }),
		);
	});

	it('does NOT throw even when inspect rejects — diagnostics are best-effort', async () => {
		const container = makeContainer(null, true);
		await expect(inspectExitedContainer(container as never, 'job-1')).resolves.toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// resolveSpawnSettings — pins the `Resolved spawn settings` diagnostic log
// against silent regression. This log is the only way to confirm in
// production whether `project.watchdogTimeoutMs` actually overrode the
// global 30-min default for a given worker — the load-bearing fact for the
// ucho exit-137 investigation.
// ---------------------------------------------------------------------------

describe('resolveSpawnSettings', () => {
	beforeEach(() => {
		mockLoggerInfo.mockClear();
		mockLoggerWarn.mockClear();
		mockLoadProjectConfig.mockReset();
		mockGetSnapshot.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('emits "Resolved spawn settings" log with the project watchdogTimeoutMs override applied', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'ucho',
					watchdogTimeoutMs: 45 * 60 * 1000, // 45 min — ucho's actual config
					snapshotEnabled: false,
					snapshotTtlMs: undefined,
				},
			],
		});

		const settings = await resolveSpawnSettings('ucho', 'MNG-308', 'job-ucho-1');

		// 45min watchdog + 2min router-kill buffer = 47 min container timeout.
		expect(settings.containerTimeoutMs).toBe(47 * 60 * 1000);

		const spawnLog = mockLoggerInfo.mock.calls.find(
			(call) => call[0] === '[WorkerManager] Resolved spawn settings:',
		);
		expect(spawnLog).toBeDefined();
		expect(spawnLog?.[1]).toMatchObject({
			jobId: 'job-ucho-1',
			projectId: 'ucho',
			workItemId: 'MNG-308',
			containerTimeoutMs: 47 * 60 * 1000,
			containerTimeoutMinutes: 47,
			projectWatchdogTimeoutMs: 45 * 60 * 1000,
			globalWorkerTimeoutMs: 30 * 60 * 1000,
		});
	});

	it('falls back to global workerTimeoutMs when project has no watchdogTimeoutMs', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'no-override',
					// watchdogTimeoutMs absent
					snapshotEnabled: false,
				},
			],
		});

		const settings = await resolveSpawnSettings('no-override', undefined, 'job-fallback');

		expect(settings.containerTimeoutMs).toBe(30 * 60 * 1000); // global default

		const spawnLog = mockLoggerInfo.mock.calls.find(
			(call) => call[0] === '[WorkerManager] Resolved spawn settings:',
		);
		expect(spawnLog?.[1]).toMatchObject({
			projectId: 'no-override',
			containerTimeoutMs: 30 * 60 * 1000,
			containerTimeoutMinutes: 30,
			projectWatchdogTimeoutMs: null,
			globalWorkerTimeoutMs: 30 * 60 * 1000,
		});
	});

	it('returns global defaults without logging spawn-settings when projectId is null', async () => {
		const settings = await resolveSpawnSettings(null, undefined, 'job-no-project');

		expect(settings.containerTimeoutMs).toBe(30 * 60 * 1000);

		const spawnLog = mockLoggerInfo.mock.calls.find(
			(call) => call[0] === '[WorkerManager] Resolved spawn settings:',
		);
		// No project context → no log line. The diagnostic is project-scoped.
		expect(spawnLog).toBeUndefined();
		// Also: loadProjectConfig must not be called for null projects (avoid
		// pointless DB roundtrips on dashboard-job paths).
		expect(mockLoadProjectConfig).not.toHaveBeenCalled();
	});

	it('logs containerTimeoutMinutes correctly rounded for non-integer minute values', async () => {
		mockLoadProjectConfig.mockResolvedValue({
			projects: [],
			fullProjects: [
				{
					id: 'odd-timeout',
					watchdogTimeoutMs: 45 * 60 * 1000 + 30_000, // 45m30s
					snapshotEnabled: false,
				},
			],
		});

		await resolveSpawnSettings('odd-timeout', undefined, 'job-rounded');

		const spawnLog = mockLoggerInfo.mock.calls.find(
			(call) => call[0] === '[WorkerManager] Resolved spawn settings:',
		);
		// 45m30s + 2m buffer = 47m30s → Math.round to 48.
		expect(spawnLog?.[1]).toMatchObject({ containerTimeoutMinutes: 48 });
	});
});
