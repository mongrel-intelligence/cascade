import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

import {
	cancelFreshMachineTimer,
	clearWatchdog,
	clearWatchdogCleanup,
	isCurrentlyProcessing,
	scheduleShutdownAfterJob,
	setProcessing,
	setWatchdogCleanup,
	startFreshMachineTimer,
	startWatchdog,
} from '../../../src/utils/lifecycle.js';

describe('lifecycle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
	});

	afterEach(() => {
		// Clean up all timers
		cancelFreshMachineTimer();
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

	describe('fresh machine timer', () => {
		it('exits after timeout when no work received', () => {
			startFreshMachineTimer(5000);

			vi.advanceTimersByTime(5000);

			expect(process.exit).toHaveBeenCalledWith(0);
		});

		it('does not exit before timeout', () => {
			startFreshMachineTimer(5000);

			vi.advanceTimersByTime(4999);

			expect(process.exit).not.toHaveBeenCalled();
		});

		it('can be cancelled', () => {
			startFreshMachineTimer(5000);
			cancelFreshMachineTimer();

			vi.advanceTimersByTime(10000);

			expect(process.exit).not.toHaveBeenCalled();
		});

		it('replaces existing timer when started again', () => {
			startFreshMachineTimer(5000);
			startFreshMachineTimer(10000);

			vi.advanceTimersByTime(5000);
			expect(process.exit).not.toHaveBeenCalled();

			vi.advanceTimersByTime(5000);
			expect(process.exit).toHaveBeenCalledWith(0);
		});
	});

	describe('watchdog', () => {
		it('force exits after timeout', () => {
			startWatchdog(30000);

			vi.advanceTimersByTime(30000);

			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it('can be cleared', () => {
			startWatchdog(30000);
			clearWatchdog();

			vi.advanceTimersByTime(60000);

			expect(process.exit).not.toHaveBeenCalled();
		});

		it('clears previous watchdog when starting new one', () => {
			startWatchdog(5000);
			startWatchdog(10000);

			vi.advanceTimersByTime(5000);
			expect(process.exit).not.toHaveBeenCalled();

			vi.advanceTimersByTime(5000);
			expect(process.exit).toHaveBeenCalledWith(1);
		});
	});

	describe('shutdown after job', () => {
		it('exits after grace period', () => {
			scheduleShutdownAfterJob(5000);

			vi.advanceTimersByTime(5000);

			expect(process.exit).toHaveBeenCalledWith(0);
		});

		it('clears watchdog when scheduling shutdown', () => {
			startWatchdog(30000);
			scheduleShutdownAfterJob(5000);

			vi.advanceTimersByTime(30000);

			// Should exit at 5000 (shutdown), not at 30000 (watchdog)
			expect(process.exit).toHaveBeenCalledTimes(1);
			expect(process.exit).toHaveBeenCalledWith(0);
		});

		it('replaces existing shutdown timer', () => {
			scheduleShutdownAfterJob(5000);
			scheduleShutdownAfterJob(10000);

			vi.advanceTimersByTime(5000);
			expect(process.exit).not.toHaveBeenCalled();

			vi.advanceTimersByTime(5000);
			expect(process.exit).toHaveBeenCalledWith(0);
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
