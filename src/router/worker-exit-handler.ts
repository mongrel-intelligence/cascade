/**
 * Post-exit handling for CASCADE worker containers.
 *
 * This module owns the load-bearing ordering after Docker `wait()` resolves:
 * inspect the still-present container, tail-log stdout/stderr, capture non-zero
 * exits, handle snapshot commit/removal, then release worker tracking state.
 */

import type Docker from 'dockerode';
import { captureException } from '../sentry.js';
import { logger } from '../utils/logging.js';
import type { ExitDetails } from './active-workers.js';

type WorkerContainer = Docker.Container;

export interface WorkerExitSnapshotDependencies {
	commitWorkerSnapshot: (
		containerId: string,
		projectId: string,
		workItemId: string,
	) => Promise<void>;
	removeWorkerContainerBestEffort: (containerId: string) => Promise<void>;
}

export interface WorkerExitDependencies extends WorkerExitSnapshotDependencies {
	cleanupWorker: (jobId: string, exitCode?: number, details?: ExitDetails) => void;
}

export interface HandleWorkerExitOptions {
	container: WorkerContainer;
	result: { StatusCode: number };
	jobId: string;
	jobType: string;
	snapshotEnabled: boolean;
	projectId: string | null;
	workItemId: string | undefined;
	dependencies: WorkerExitDependencies;
}

/**
 * Inspect a just-exited container and pull the diagnostic facts that explain
 * its exit. `OOMKilled` and `State.Error` are only available before AutoRemove
 * (or our manual `removeContainer`) reaps the container, so this MUST run
 * before either path. Returns nullable fields when inspection fails - never
 * throws.
 */
export async function inspectExitedContainer(
	container: WorkerContainer,
	jobId: string,
): Promise<{ oomKilled?: boolean; exitReason?: string; durationMs?: number }> {
	// Wrap in try/catch - `inspect()` can fail post-exit if the daemon socket
	// drops, the container is reaped between `wait()` and here, or the API
	// times out. Diagnostics are best-effort; falling back to undefined is
	// safer than failing the whole post-exit pipeline.
	let inspectResult: Awaited<ReturnType<typeof container.inspect>> | null = null;
	try {
		inspectResult = await container.inspect();
	} catch (err) {
		logger.warn('[WorkerManager] container.inspect() after wait failed:', {
			jobId,
			error: String(err),
		});
	}
	const state = inspectResult?.State;
	const oomKilled = state?.OOMKilled;
	// Empty `State.Error` (the common case for clean exits) -> undefined so the
	// run-record reason string omits the `reason="..."` segment entirely.
	const exitReason = state?.Error?.length ? state.Error : undefined;
	const startedAtIso = state?.StartedAt;
	const finishedAtIso = state?.FinishedAt;
	// Docker can report sentinel timestamps (e.g. `0001-01-01T00:00:00Z` for a
	// container that never fully started) that parse to NaN - drop those so
	// downstream logs/Sentry don't ship `durationMs: NaN`.
	const rawDurationMs =
		startedAtIso && finishedAtIso
			? new Date(finishedAtIso).getTime() - new Date(startedAtIso).getTime()
			: undefined;
	const durationMs =
		rawDurationMs !== undefined && Number.isFinite(rawDurationMs) && rawDurationMs >= 0
			? rawDurationMs
			: undefined;
	return { oomKilled, exitReason, durationMs };
}

/**
 * Tail-log the worker's stdout/stderr for at-a-glance debugging. Full
 * per-worker logs are also indexed in Loki via promtail's per-container label
 * (`{container="/cascade-worker-${jobId}"}`); this 50-line tail is a
 * convenience and is not load-bearing.
 */
async function logWorkerTail(container: WorkerContainer): Promise<void> {
	try {
		const logs = await container.logs({ stdout: true, stderr: true, follow: false });
		const logText = logs.toString('utf-8');
		if (!logText.trim()) return;
		const lines = logText.trim().split('\n');
		const tail = lines.slice(-50).join('\n');
		logger.info(
			`[WorkerManager] Worker logs (last ${Math.min(lines.length, 50)} of ${lines.length} lines):\n${tail}`,
		);
	} catch {
		// Container may already be removed - expected with AutoRemove.
	}
}

/**
 * Handle a worker container after Docker reports exit. Keep inspection before
 * snapshot/manual removal so OOMKilled, State.Error, and duration facts survive.
 */
export async function handleWorkerExit(opts: HandleWorkerExitOptions): Promise<void> {
	const {
		container,
		result,
		jobId,
		jobType,
		snapshotEnabled,
		projectId,
		workItemId,
		dependencies,
	} = opts;

	const { oomKilled, exitReason, durationMs } = await inspectExitedContainer(container, jobId);
	await logWorkerTail(container);

	if (result.StatusCode !== 0) {
		captureException(new Error(`Worker exited with status ${result.StatusCode}`), {
			tags: { source: 'worker_exit', jobType },
			extra: { jobId, statusCode: result.StatusCode, oomKilled, exitReason, durationMs },
		});
	}
	logger.info('[WorkerManager] Worker exited:', {
		jobId,
		statusCode: result.StatusCode,
		oomKilled: oomKilled ?? null,
		exitReason: exitReason ?? null,
		durationMs: durationMs ?? null,
	});

	if (snapshotEnabled) {
		if (result.StatusCode === 0 && projectId && workItemId) {
			await dependencies.commitWorkerSnapshot(container.id, projectId, workItemId);
		} else if (result.StatusCode !== 0) {
			logger.info('[WorkerManager] Skipping snapshot commit after non-zero exit:', {
				jobId,
				statusCode: result.StatusCode,
			});
		}
		// Always remove manually since AutoRemove is disabled for snapshot runs.
		await dependencies.removeWorkerContainerBestEffort(container.id);
	}

	dependencies.cleanupWorker(jobId, result.StatusCode, { oomKilled, exitReason });
}
