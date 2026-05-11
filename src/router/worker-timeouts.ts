/**
 * Timeout cancellation workflow for CASCADE worker containers.
 *
 * Owns the router-side timeout path: stop the Docker container, mark the run
 * `timed_out`, notify the PM/SCM surface, and clear active-worker state without
 * letting the generic crash cleanup overwrite the timeout status.
 */

import Docker from 'dockerode';
import { failOrphanedRun, failOrphanedRunFallback } from '../db/repositories/runsRepository.js';
import { logger } from '../utils/logging.js';
import { activeWorkers, cleanupWorker } from './active-workers.js';
import { notifyTimeout } from './notifications.js';

const docker = new Docker();

/**
 * Kill a worker container after the router watchdog fires:
 * 1. SIGTERM via container.stop(t=15) gives the agent watchdog time to clean up.
 * 2. Docker auto-escalates to SIGKILL after 15s.
 * 3. Router marks the run timed_out and posts its own timeout notification.
 */
export async function killWorker(jobId: string): Promise<void> {
	const worker = activeWorkers.get(jobId);
	if (!worker) return;

	try {
		const container = docker.getContainer(worker.containerId);
		await container.stop({ t: 15 });
		logger.info('[WorkerManager] Worker stopped:', { jobId });
	} catch (err) {
		// Container might already be stopped; timeout reporting still needs to run.
		logger.warn('[WorkerManager] Error stopping worker (may already be stopped):', {
			jobId,
			error: String(err),
		});
	}

	const durationMs = Date.now() - worker.startedAt.getTime();

	// Update DB run status to timed_out (fire-and-forget, no-op if watchdog already did it).
	// cleanupWorker is called below without an exitCode so it skips its own DB update,
	// avoiding a race where the wrong status ('failed') could win.
	if (worker.projectId) {
		const dbUpdate = worker.workItemId
			? failOrphanedRun(
					worker.projectId,
					worker.workItemId,
					'Router timeout',
					'timed_out',
					durationMs,
				)
			: failOrphanedRunFallback(
					worker.projectId,
					worker.agentType,
					worker.startedAt,
					'timed_out',
					'Router timeout',
					durationMs,
				);
		dbUpdate
			.then((runId) => {
				if (runId)
					logger.info('[WorkerManager] Marked run timed_out after router kill', {
						jobId,
						runId,
					});
			})
			.catch((err) =>
				logger.error('[WorkerManager] DB update failed after router kill', {
					jobId,
					error: String(err),
				}),
			);
	}

	// Send timeout notification (fire-and-forget).
	notifyTimeout(worker.job, {
		jobId: worker.jobId,
		startedAt: worker.startedAt,
		durationMs,
	}).catch((err) => {
		logger.error('[WorkerManager] Timeout notification error:', String(err));
	});

	// No exitCode: DB update is handled above with the correct timed_out status.
	cleanupWorker(jobId);
}
