import { logger } from './logging.js';

let selfDestructTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let isProcessing = false;
let shutdownRequested = false;
let watchdogCleanup: (() => Promise<void>) | null = null;

export function startSelfDestructTimer(timeoutMs: number): void {
	resetSelfDestructTimer(timeoutMs);
}

export function resetSelfDestructTimer(timeoutMs: number): void {
	if (selfDestructTimer) {
		clearTimeout(selfDestructTimer);
	}

	logger.debug('Self-destruct timer reset', { timeoutMs });

	selfDestructTimer = setTimeout(() => {
		if (isProcessing) {
			logger.info('Self-destruct timer expired during processing, will shutdown after completion');
			shutdownRequested = true;
		} else {
			logger.info('Self-destruct timer expired, shutting down');
			process.exit(0);
		}
	}, timeoutMs);
}

export function setProcessing(processing: boolean, timeoutMs?: number): void {
	isProcessing = processing;

	if (!processing && shutdownRequested) {
		logger.info('Processing complete and shutdown requested, shutting down');
		process.exit(0);
	}

	if (!processing && timeoutMs) {
		resetSelfDestructTimer(timeoutMs);
	}
}

export function isCurrentlyProcessing(): boolean {
	return isProcessing;
}

export function cancelSelfDestruct(): void {
	if (selfDestructTimer) {
		clearTimeout(selfDestructTimer);
		selfDestructTimer = null;
	}
	shutdownRequested = false;
}

// Watchdog cleanup callback - called before force exit
export function setWatchdogCleanup(cleanup: () => Promise<void>): void {
	watchdogCleanup = cleanup;
}

export function clearWatchdogCleanup(): void {
	watchdogCleanup = null;
}

// Watchdog timer - force kills if job exceeds maximum duration
export function startWatchdog(timeoutMs: number): void {
	clearWatchdog();

	logger.info('Watchdog started', { timeoutMs });

	watchdogTimer = setTimeout(async () => {
		logger.error('Watchdog timeout! Job exceeded maximum duration');

		if (watchdogCleanup) {
			try {
				await Promise.race([
					watchdogCleanup(),
					new Promise<never>((_, reject) =>
						setTimeout(() => reject(new Error('Cleanup timeout')), 10000),
					),
				]);
			} catch (err) {
				logger.error('Watchdog cleanup failed', { error: String(err) });
			}
		}

		logger.error('Force exiting');
		process.exit(1);
	}, timeoutMs);
}

export function clearWatchdog(): void {
	if (watchdogTimer) {
		clearTimeout(watchdogTimer);
		watchdogTimer = null;
	}
}

// Schedule shutdown shortly after job completion
export function scheduleShutdownAfterJob(gracePeriodMs = 5000): void {
	clearWatchdog();

	if (selfDestructTimer) {
		clearTimeout(selfDestructTimer);
	}

	logger.info('Job complete, scheduling shutdown', { gracePeriodMs });

	selfDestructTimer = setTimeout(() => {
		logger.info('Grace period complete, shutting down');
		process.exit(0);
	}, gracePeriodMs);
}
