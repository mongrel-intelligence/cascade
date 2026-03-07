import { flush } from '../sentry.js';
import { logger } from './logging.js';

let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogCleanup: (() => Promise<void>) | null = null;

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

		await flush(3000);
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
