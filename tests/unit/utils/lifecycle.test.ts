import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../src/sentry.js', () => ({
	flush: vi.fn().mockResolvedValue(undefined),
}));

import { flush } from '../../../src/sentry.js';
import {
	clearWatchdog,
	clearWatchdogCleanup,
	isCurrentlyProcessing,
	setProcessing,
	setWatchdogCleanup,
	startWatchdog,
} from '../../../src/utils/lifecycle.js';

const mockFlush = vi.mocked(flush);

describe('lifecycle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
	});

	afterEach(() => {
		// Clean up all timers
		clearWatchdog();
		clearWatchdogCleanup();
		setProcessing(false);
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe('processing state', () => {
		it('defaults to not processing', () => {
			expect(isCurrentlyProcessing()).toBe(false);
		});

		it('can set processing to true', () => {
			setProcessing(true);
			expect(isCurrentlyProcessing()).toBe(true);
		});

		it('can set processing back to false', () => {
			setProcessing(true);
			setProcessing(false);
			expect(isCurrentlyProcessing()).toBe(false);
		});
	});

	describe('watchdog', () => {
		it('force exits after timeout', async () => {
			startWatchdog(30000);

			await vi.advanceTimersByTimeAsync(30000);

			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it('flushes Sentry before force exit', async () => {
			startWatchdog(30000);

			await vi.advanceTimersByTimeAsync(30000);

			expect(mockFlush).toHaveBeenCalledWith(3000);
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it('can be cleared', () => {
			startWatchdog(30000);
			clearWatchdog();

			vi.advanceTimersByTime(60000);

			expect(process.exit).not.toHaveBeenCalled();
		});

		it('clears previous watchdog when starting new one', async () => {
			startWatchdog(5000);
			startWatchdog(10000);

			await vi.advanceTimersByTimeAsync(5000);
			expect(process.exit).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(5000);
			expect(process.exit).toHaveBeenCalledWith(1);
		});
	});

	describe('watchdog cleanup', () => {
		it('can set and clear watchdog cleanup', () => {
			const cleanup = vi.fn().mockResolvedValue(undefined);
			setWatchdogCleanup(cleanup);
			clearWatchdogCleanup();

			// No assertion needed, just ensuring no errors
		});
	});
});
