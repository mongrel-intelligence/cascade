/**
 * In-memory sliding-window rate limiter for the login endpoint.
 *
 * Tracks login attempts per IP address. After MAX_ATTEMPTS within the
 * WINDOW_MS window, subsequent requests are rejected with a 429 response
 * that includes a Retry-After header.
 *
 * Only failed login attempts are counted. A successful login resets the
 * counter for the IP so it is not counted against the rate limit.
 *
 * A cleanup interval runs every CLEANUP_INTERVAL_MS to evict expired entries
 * and prevent unbounded memory growth.
 */

export const MAX_ATTEMPTS = 10;
export const WINDOW_MS = 60_000; // 1 minute

const CLEANUP_INTERVAL_MS = 5 * 60_000; // 5 minutes

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

// Exported for testing
export const rateLimitStore = new Map<string, RateLimitEntry>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic cleanup interval (idempotent).
 * Called lazily on first use so tests can control timing.
 */
function ensureCleanupStarted(): void {
	if (cleanupTimer !== null) return;
	cleanupTimer = setInterval(() => {
		const now = Date.now();
		for (const [ip, entry] of rateLimitStore) {
			if (now >= entry.resetAt) {
				rateLimitStore.delete(ip);
			}
		}
	}, CLEANUP_INTERVAL_MS);
	// Allow Node.js process to exit even if the interval is running
	if (cleanupTimer.unref) {
		cleanupTimer.unref();
	}
}

/**
 * Reset the cleanup timer — used in tests only.
 */
export function _resetForTesting(): void {
	if (cleanupTimer !== null) {
		clearInterval(cleanupTimer);
		cleanupTimer = null;
	}
	rateLimitStore.clear();
}

/**
 * Run the cleanup sweep — used in tests only.
 */
export function _runCleanup(): void {
	const now = Date.now();
	for (const [ip, entry] of rateLimitStore) {
		if (now >= entry.resetAt) {
			rateLimitStore.delete(ip);
		}
	}
}

/**
 * Check whether the IP has exceeded the rate limit.
 *
 * @returns `{ limited: false }` when within the limit, or
 *          `{ limited: true, retryAfterSeconds: number }` when over the limit.
 */
export function checkRateLimit(
	ip: string,
): { limited: false } | { limited: true; retryAfterSeconds: number } {
	ensureCleanupStarted();

	const now = Date.now();
	const entry = rateLimitStore.get(ip);

	if (!entry || now >= entry.resetAt) {
		// No entry or window has expired — first attempt in a new window
		rateLimitStore.set(ip, { count: 1, resetAt: now + WINDOW_MS });
		return { limited: false };
	}

	if (entry.count >= MAX_ATTEMPTS) {
		const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
		return { limited: true, retryAfterSeconds };
	}

	entry.count += 1;
	return { limited: false };
}

/**
 * Record a successful login for the IP — resets the counter so successful
 * logins are not counted against the rate limit.
 */
export function recordSuccessfulLogin(ip: string): void {
	rateLimitStore.delete(ip);
}
