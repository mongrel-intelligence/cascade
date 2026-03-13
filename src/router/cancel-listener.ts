/**
 * Cancel command listener for the router.
 *
 * Subscribes to Redis cancel commands published by the Dashboard API.
 * When a cancel command is received, looks up the jobId from the database
 * and kills the corresponding worker container.
 */

import { getRunJobId } from '../db/repositories/runsRepository.js';
import { subscribeToCancelCommands, unsubscribeFromCancelCommands } from '../queue/cancel.js';
import { logger } from '../utils/logging.js';
import { killWorker } from './container-manager.js';

let cancelSubscriberActive = false;

/**
 * Start listening for cancel commands on the Redis cancel channel.
 *
 * For each cancel command, attempts to look up the jobId from the database
 * and kills the corresponding worker. If the jobId is not found in the
 * database, logs a warning — no Docker fallback is attempted, as containers
 * carry no run ID label and a fallback would risk killing the wrong container
 * in multi-run environments.
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
					// jobId not found — container labels carry no run ID so we cannot safely
					// match a container to this run. Log a warning and skip to avoid killing
					// the wrong worker in multi-run environments.
					logger.warn(
						'[CancelListener] JobId not found in DB for run — cannot cancel worker safely:',
						{ runId },
					);
				}
			} catch (err) {
				logger.error('[CancelListener] Error processing cancel command:', {
					runId,
					reason,
					error: String(err),
				});
			}
		});

		cancelSubscriberActive = true;
		logger.info('[CancelListener] Cancel listener started');
	} catch (err) {
		logger.error('[CancelListener] Failed to start cancel listener:', { error: String(err) });
		throw err;
	}
}

/**
 * Stop listening for cancel commands and close the Redis subscriber connection.
 */
export async function stopCancelListener(): Promise<void> {
	if (!cancelSubscriberActive) return;

	try {
		await unsubscribeFromCancelCommands();
		cancelSubscriberActive = false;
		logger.info('[CancelListener] Cancel listener stopped');
	} catch (err) {
		logger.error('[CancelListener] Error stopping cancel listener:', { error: String(err) });
	}
}
