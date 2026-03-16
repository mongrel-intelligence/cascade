import ora from 'ora';

/**
 * Returns true if spinners should be suppressed (silent mode).
 * Spinners are suppressed when:
 * - --json flag would be passed (NO_COLOR env var is set)
 * - CI environment detected
 * - NO_COLOR env var set (convention for disabling colors/animations)
 * - Explicitly requested via `silent` option
 */
export function isSilentMode(options?: { silent?: boolean }): boolean {
	if (options?.silent) return true;
	if (process.env.NO_COLOR) return true;
	if (process.env.CI) return true;
	return false;
}

/**
 * Wraps an async function with an animated spinner.
 * Clears the spinner on success or failure.
 * Spinner is automatically suppressed in CI, NO_COLOR, or when `silent` is true.
 *
 * @param message - The spinner text to display while `fn` is running
 * @param fn - The async function to execute
 * @param options - Optional configuration
 * @returns The result of `fn`
 */
export async function withSpinner<T>(
	message: string,
	fn: () => Promise<T>,
	options?: { silent?: boolean },
): Promise<T> {
	const silent = isSilentMode(options);

	if (silent) {
		return fn();
	}

	const spinner = ora(message).start();
	try {
		const result = await fn();
		spinner.stop();
		return result;
	} catch (err) {
		spinner.stop();
		throw err;
	}
}
