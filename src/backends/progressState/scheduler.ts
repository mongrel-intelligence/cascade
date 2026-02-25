/**
 * Progressive timer scheduler for CASCADE progress monitor.
 *
 * Fires a tick callback according to a progressive schedule (e.g., 1min,
 * 3min, 5min) before falling back to a steady-state interval. Pure
 * scheduling — no business logic.
 */

/** Default progressive schedule: 1min, 3min, 5min, then every intervalMinutes */
export const DEFAULT_SCHEDULE_MINUTES = [1, 3, 5];

export class ProgressScheduler {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private tickIndex = 0;
	private stopped = false;

	constructor(
		private readonly schedule: number[],
		private readonly intervalMinutes: number,
	) {}

	/**
	 * Start the scheduler, calling `tickFn` on each tick.
	 * `tickFn` is awaited before the next tick is scheduled.
	 */
	start(tickFn: () => Promise<void>): void {
		this.scheduleNextTick(tickFn);
	}

	/** Stop the scheduler. No more ticks will fire after this call. */
	stop(): void {
		this.stopped = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private scheduleNextTick(tickFn: () => Promise<void>): void {
		const delayMinutes =
			this.tickIndex < this.schedule.length ? this.schedule[this.tickIndex] : this.intervalMinutes;
		const delayMs = delayMinutes * 60 * 1000;
		this.timer = setTimeout(() => {
			void this.tickAndScheduleNext(tickFn);
		}, delayMs);
	}

	private async tickAndScheduleNext(tickFn: () => Promise<void>): Promise<void> {
		await tickFn();
		this.tickIndex++;
		if (!this.stopped) {
			this.scheduleNextTick(tickFn);
		}
	}
}
