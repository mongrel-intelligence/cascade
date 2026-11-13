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

let watchdogExitCode: () => Promise<number> | number = () => 1;

/** Lets the worker choose the watchdog's exit code (e.g. 3 after a subscription rate limit). */
export function setWatchdogExitCodeResolver(resolve: () => Promise<number> | number): void {
	watchdogExitCode = resolve;
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
		let code = 1;
		try {
			code = await watchdogExitCode();
		} catch {
			code = 1;
		}
		process.exit(code);
	}, timeoutMs);
}

export function clearWatchdog(): void {
	if (watchdogTimer) {
		clearTimeout(watchdogTimer);
		watchdogTimer = null;
	}
}
