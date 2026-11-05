/**
 * Polling configuration.
 *
 * All values are read from environment variables with sensible defaults.
 * POLLING_ENABLED is the master switch; when false, the scheduler is not started.
 */

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
	if (value === undefined || value === '') return defaultValue;
	return value.toLowerCase() === 'true' || value === '1';
}

function parseNumber(value: string | undefined, defaultValue: number): number {
	if (value === undefined || value === '') return defaultValue;
	const parsed = Number(value);
	return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Polling configuration object. All values are resolved at module load time.
 */
export const pollingConfig = {
	/** Master switch for polling. When false, the scheduler is not started. */
	enabled: parseBoolean(process.env.POLLING_ENABLED, false),

	/** Polling interval in milliseconds. Default: 60 seconds. */
	intervalMs: parseNumber(process.env.POLLING_INTERVAL_MS, 60_000),

	/** Overlap window for JIRA queries in minutes. Default: 2 minutes. */
	jiraOverlapMinutes: parseNumber(process.env.POLLING_JIRA_OVERLAP_MINUTES, 2),

	/** Fixed lookback window for GitHub workflow runs in milliseconds. Default: 6 hours. */
	githubLookbackMs: parseNumber(process.env.POLLING_GITHUB_LOOKBACK_MS, 6 * 60 * 60 * 1000),

	/** Max PRs per repo to check for reviews. Default: 30. */
	githubPrBatchSize: parseNumber(process.env.POLLING_GITHUB_PR_BATCH_SIZE, 30),

	/** Dedup ledger retention in days. Default: 30 days. */
	dedupRetentionDays: parseNumber(process.env.POLLING_DEDUP_RETENTION_DAYS, 30),
} as const;

/** Type for the polling config object. */
export type PollingConfig = typeof pollingConfig;

/**
 * Watermark overlap window in milliseconds.
 *
 * When advancing the watermark, we subtract this value from the cycle start time
 * to ensure that events occurring during cycle execution are not missed.
 * This creates a small overlap window where events may be re-scanned, but the
 * dedup ledger ensures they are not processed twice.
 *
 * Not configurable via env var as this is an implementation detail.
 */
export const WATERMARK_OVERLAP_MS = 5000;
