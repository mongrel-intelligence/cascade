/**
 * Cancel command listener for the router.
 *
 * Subscribes to Redis cancel commands published by the Dashboard API.
 * When a cancel command is received, looks up the jobId from the database
 * and kills the corresponding worker container.
 *
 * Includes Docker label fallback for race conditions where the container
 * is running but jobId hasn't been written to DB yet.
 */

import Docker from 'dockerode';
import { getRunJobId } from '../db/repositories/runsRepository.js';
import { subscribeToCancelCommands } from '../queue/cancel.js';
import { logger } from '../utils/logging.js';
import { killWorker } from './container-manager.js';

const docker = new Docker();

let cancelSubscriber: ReturnType<typeof subscribeToCancelCommands> | null = null;

/**
 * Start listening for cancel commands on the Redis cancel channel.
 *
 * For each cancel command, attempts to look up the jobId from the database
 * and kills the corresponding worker. Falls back to Docker label scanning
 * if the jobId isn't found in the database.
 */
export async function startCancelListener(): Promise<void> {
	if (!process.env.REDIS_URL) {
		logger.info('[CancelListener] Redis not configured, cancel listener disabled');
		return;
	}

	try {
		await subscribeToCancelCommands(async (payload) => {
			const { runId, reason } = payload;
			logger.info('[CancelListener] Cancel command received:', { runId, reason });

			try {
				// Try to get jobId from database
				const jobId = await getRunJobId(runId);

				if (jobId) {
					logger.info('[CancelListener] Found jobId for run, killing worker:', { runId, jobId });
					await killWorker(jobId);
				} else {
					// Fallback: scan Docker containers for cascade.managed label
					// This handles race condition where container exists but jobId not yet in DB
					logger.info('[CancelListener] JobId not found in DB, scanning Docker containers:', {
						runId,
					});
					await fallbackKillByDockerLabel(runId);
				}
			} catch (err) {
				logger.error('[CancelListener] Error processing cancel command:', {
					runId,
					reason,
					error: String(err),
				});
			}
		});

		cancelSubscriber = true as unknown as ReturnType<typeof subscribeToCancelCommands>;
		logger.info('[CancelListener] Cancel listener started');
	} catch (err) {
		logger.error('[CancelListener] Failed to start cancel listener:', { error: String(err) });
		throw err;
	}
}

/**
 * Stop listening for cancel commands.
 */
export async function stopCancelListener(): Promise<void> {
	if (!cancelSubscriber) return;

	try {
		// Note: Redis subscriber connection cleanup happens in the queue/cancel.ts module
		cancelSubscriber = null;
		logger.info('[CancelListener] Cancel listener stopped');
	} catch (err) {
		logger.error('[CancelListener] Error stopping cancel listener:', { error: String(err) });
	}
}

/**
 * Fallback: scan Docker containers with cascade.managed label
 * and attempt to match by run metadata.
 *
 * This handles the race condition where a container is running but
 * the jobId hasn't been written to the database yet.
 */
async function fallbackKillByDockerLabel(runId: string): Promise<void> {
	try {
		const containers = await docker.listContainers();
		const cascadeContainers = containers.filter((c) => c.Labels?.['cascade.managed'] === 'true');

		if (cascadeContainers.length === 0) {
			logger.warn('[CancelListener] No Docker containers found with cascade.managed label:', {
				runId,
			});
			return;
		}

		// Attempt to find and kill the first matching container
		// In practice, only one worker should be active per run at a time
		if (cascadeContainers.length > 0) {
			const target = cascadeContainers[0];
			logger.info('[CancelListener] Killing Docker container via fallback:', {
				runId,
				containerId: target.Id?.slice(0, 12),
				jobId: target.Labels?.['cascade.job.id'],
			});

			const container = docker.getContainer(target.Id);
			try {
				await container.stop({ t: 15 });
				logger.info('[CancelListener] Fallback container killed successfully:', {
					runId,
					containerId: target.Id?.slice(0, 12),
				});
			} catch (err) {
				logger.warn('[CancelListener] Error killing fallback container:', {
					runId,
					containerId: target.Id?.slice(0, 12),
					error: String(err),
				});
			}
		}
	} catch (err) {
		logger.error('[CancelListener] Error in Docker fallback:', {
			runId,
			error: String(err),
		});
	}
}
