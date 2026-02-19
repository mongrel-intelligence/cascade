/**
 * Sentry integration utilities for CASCADE.
 *
 * Provides centralized error reporting with structured context.
 * All functions are no-ops when SENTRY_DSN is not set.
 */

import * as Sentry from '@sentry/node';

let initialized = false;

/**
 * Initialize Sentry for a given service.
 * Reads SENTRY_DSN from environment; no-op if unset.
 */
export function initSentry(serviceName: string): void {
	const dsn = process.env.SENTRY_DSN;
	if (!dsn) {
		return;
	}

	Sentry.init({
		dsn,
		serverName: serviceName,
		tracesSampleRate: 0,
	});

	initialized = true;
}

export interface RunFailureContext {
	runId?: string;
	agentType?: string;
	projectId?: string;
	cardId?: string;
	triggerType?: string;
	backendName?: string;
	durationMs?: number;
}

/**
 * Capture a run failure with structured context tags.
 * No-op if Sentry is not initialized.
 */
export function captureRunFailure(error: unknown, context: RunFailureContext): void {
	if (!initialized) return;

	const err = error instanceof Error ? error : new Error(String(error));

	Sentry.withScope((scope) => {
		if (context.runId) scope.setTag('runId', context.runId);
		if (context.agentType) scope.setTag('agentType', context.agentType);
		if (context.projectId) scope.setTag('projectId', context.projectId);
		if (context.cardId) scope.setTag('cardId', context.cardId);
		if (context.triggerType) scope.setTag('triggerType', context.triggerType);
		if (context.backendName) scope.setTag('backendName', context.backendName);
		if (context.durationMs !== undefined) scope.setExtra('durationMs', context.durationMs);
		scope.setTag('errorType', 'run_failure');

		Sentry.captureException(err);
	});
}

export interface WorkerErrorContext {
	jobId?: string;
	jobType?: string;
}

/**
 * Capture a worker-level error with job context tags.
 * No-op if Sentry is not initialized.
 */
export function captureWorkerError(error: unknown, context: WorkerErrorContext): void {
	if (!initialized) return;

	const err = error instanceof Error ? error : new Error(String(error));

	Sentry.withScope((scope) => {
		if (context.jobId) scope.setTag('jobId', context.jobId);
		if (context.jobType) scope.setTag('jobType', context.jobType);
		scope.setTag('errorType', 'worker_error');

		Sentry.captureException(err);
	});
}

/**
 * Flush pending Sentry events and close the client.
 * Should be called before process.exit() to ensure events are sent.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
	if (!initialized) return;
	await Sentry.close(timeoutMs);
}
