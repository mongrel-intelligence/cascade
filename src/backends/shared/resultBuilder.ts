/**
 * Shared result-building helpers for agent engine result construction.
 *
 * Provides field assemblers for common `AgentEngineResult` sub-objects that are
 * constructed identically across multiple engine implementations. Import these
 * helpers instead of inlining the object literals so the shape stays consistent
 * and easy to update in one place.
 */

import type { PrEvidence } from '../types.js';

/**
 * Build the PR evidence object for text-extracted PR URLs.
 *
 * Returns `{ source: 'text', authoritative: false }` when `prUrl` is a
 * non-empty string, or `undefined` when `prUrl` is falsy. Engines should
 * call this immediately after extracting the PR URL from agent output.
 *
 * @example
 * const prUrl = extractPRUrl(output);
 * const prEvidence = buildTextPrEvidence(prUrl);
 */
export function buildTextPrEvidence(prUrl: string | undefined | null): PrEvidence | undefined {
	if (!prUrl) {
		return undefined;
	}
	return {
		source: 'text' as const,
		authoritative: false,
	};
}
