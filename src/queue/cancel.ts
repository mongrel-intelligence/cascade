/**
 * Redis pub/sub module for cancel command distribution.
 *
 * Provides a mechanism for the Dashboard to publish cancel commands that the Router
 * receives and uses to terminate running agent jobs.
 */

import { Redis } from 'ioredis';

// ── Types ────────────────────────────────────────────────────────────────

export interface CancelCommandPayload {
	runId: string;
	reason: string;
}

type CancelCommandHandler = (payload: CancelCommandPayload) => Promise<void>;

// ── Channel ──────────────────────────────────────────────────────────────

const CANCEL_CHANNEL = 'cascade:cancel';

// ── Instance caching ────────────────────────────────────────────────────

let publisherInstance: Redis | null = null;
let subscriberInstance: Redis | null = null;

function getPublisher(): Redis {
	if (!publisherInstance) {
		const redisUrl = process.env.REDIS_URL;
		if (!redisUrl) {
			throw new Error('REDIS_URL is required for cancel pub/sub');
		}
		publisherInstance = new Redis(redisUrl);
	}
	return publisherInstance;
}

function getSubscriber(): Redis {
	if (!subscriberInstance) {
		const redisUrl = process.env.REDIS_URL;
		if (!redisUrl) {
			throw new Error('REDIS_URL is required for cancel pub/sub');
		}
		subscriberInstance = new Redis(redisUrl);
	}
	return subscriberInstance;
}

// ── Publish ──────────────────────────────────────────────────────────────

/**
 * Publish a cancel command to the cascade:cancel channel.
 *
 * The Router process subscribes to this channel and uses the runId to
 * identify and terminate the corresponding job.
 *
 * @param runId - The agent run ID to cancel
 * @param reason - Human-readable reason for cancellation (e.g., "user requested", "timeout")
 */
export async function publishCancelCommand(runId: string, reason: string): Promise<void> {
	const publisher = getPublisher();
	const payload: CancelCommandPayload = { runId, reason };
	await publisher.publish(CANCEL_CHANNEL, JSON.stringify(payload));
}

// ── Subscribe ────────────────────────────────────────────────────────────

/**
 * Subscribe to cancel commands from the cascade:cancel channel.
 *
 * Invokes the handler callback for each cancel command received.
 * The handler should look up the run's jobId from the database and
 * use it to kill the job in BullMQ.
 *
 * @param handler - Callback function invoked with each cancel payload
 */
export async function subscribeToCancelCommands(handler: CancelCommandHandler): Promise<void> {
	const subscriber = getSubscriber();

	subscriber.on('message', async (channel, message) => {
		if (channel === CANCEL_CHANNEL) {
			try {
				const payload = JSON.parse(message) as CancelCommandPayload;
				await handler(payload);
			} catch (error) {
				console.error('[cancel] Failed to handle cancel command:', error);
			}
		}
	});

	await subscriber.subscribe(CANCEL_CHANNEL);
}

/**
 * Unsubscribe from the cancel channel and close the subscriber connection.
 *
 * Should be called during graceful shutdown to release the Redis connection.
 */
export async function unsubscribeFromCancelCommands(): Promise<void> {
	if (!subscriberInstance) return;

	try {
		await subscriberInstance.unsubscribe(CANCEL_CHANNEL);
		subscriberInstance.disconnect();
		subscriberInstance = null;
	} catch (error) {
		console.error('[cancel] Failed to unsubscribe from cancel commands:', error);
	}
}
