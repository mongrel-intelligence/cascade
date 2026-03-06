/**
 * Assert that a value is defined (not null/undefined), throwing if not.
 * Complies with Biome's `noNonNullAssertion` rule as a safer alternative to `!`.
 */
export function assertFound<T>(
	value: T | null | undefined,
	msg = 'Expected value to be defined',
): T {
	if (value == null) throw new Error(msg);
	return value;
}
