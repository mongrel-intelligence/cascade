import { expect } from 'vitest';
import type { TriggerResult } from '../../src/types/index.js';

/**
 * Assert that a TriggerResult is a structured self-skip — i.e. `agentType`
 * is null and `skipReason` is populated.
 *
 * After the R1 refactor, every handler's self-skip path returns a
 * structured skip via `skip()` instead of bare `null`. This helper keeps
 * the per-handler assertions terse:
 *
 * ```ts
 * expectSkip(result, 'check-suite-failure', /not authored by a cascade persona/);
 * ```
 *
 * - `expectedHandler` (optional): the trigger's `name` field; pinning it
 *   guards against the wrong handler claiming the skip.
 * - `messageMatcher` (optional): substring or RegExp the skip message
 *   must match. Pin the specific case under test.
 */
export function expectSkip(
	result: TriggerResult | null,
	expectedHandler?: string,
	messageMatcher?: string | RegExp,
): void {
	expect(result, 'expected a structured skip TriggerResult, not null').not.toBeNull();
	expect(result?.agentType).toBeNull();
	expect(result?.skipReason).toBeDefined();
	if (expectedHandler !== undefined) {
		expect(result?.skipReason?.handler).toBe(expectedHandler);
	}
	if (messageMatcher !== undefined) {
		if (typeof messageMatcher === 'string') {
			expect(result?.skipReason?.message).toContain(messageMatcher);
		} else {
			expect(result?.skipReason?.message).toMatch(messageMatcher);
		}
	}
}

/**
 * Bound variant: returns a partial-applied `expectSkip` where the handler
 * name is pinned at the top of a test file. Lets per-handler test files
 * keep terse assertion sites without redefining a one-line wrapper:
 *
 * ```ts
 * const expectSkip = expectSkipFor('check-suite-failure');
 * expectSkip(result);                              // just shape
 * expectSkip(result, /not authored by a cascade/); // shape + message
 * ```
 */
export function expectSkipFor(
	handler: string,
): (result: TriggerResult | null, messageMatcher?: string | RegExp) => void {
	return (result, messageMatcher) => expectSkip(result, handler, messageMatcher);
}
