import { logger } from './logging.js';

let selfDestructTimer: ReturnType<typeof setTimeout> | null = null;
let isProcessing = false;
let shutdownRequested = false;

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
