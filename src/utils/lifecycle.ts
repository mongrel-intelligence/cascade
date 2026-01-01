import { logger } from './logging.js';

let freshMachineTimer: ReturnType<typeof setTimeout> | null = null;
let shutdownTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let isProcessing = false;
let watchdogCleanup: (() => Promise<void>) | null = null;

// Fresh machine timer - exits if no work received after boot
export function startFreshMachineTimer(timeoutMs: number): void {
	if (freshMachineTimer) {
		clearTimeout(freshMachineTimer);
	}

	logger.info('Fresh machine timer started', { timeoutMs });

	freshMachineTimer = setTimeout(() => {
		logger.info('No work received, shutting down fresh machine');
		process.exit(0);
	}, timeoutMs);
}

export function cancelFreshMachineTimer(): void {
	if (freshMachineTimer) {
		clearTimeout(freshMachineTimer);
		freshMachineTimer = null;
		logger.debug('Fresh machine timer cancelled (work received)');
	}
}

export function setProcessing(processing: boolean): void {
	isProcessing = processing;
}

export function isCurrentlyProcessing(): boolean {
	return isProcessing;
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

	if (shutdownTimer) {
		clearTimeout(shutdownTimer);
	}

	logger.info('Job complete, scheduling shutdown', { gracePeriodMs });

	shutdownTimer = setTimeout(() => {
		logger.info('Grace period complete, shutting down');
		process.exit(0);
	}, gracePeriodMs);
}
