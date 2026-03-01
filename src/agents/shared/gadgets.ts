/**
 * Gadget Building
 *
 * Builds gadget instances from agent capabilities.
 * This replaces the old builder functions (buildWorkItemGadgets, buildReviewGadgets, etc.)
 * with a unified capability-driven approach.
 */

import { GetPRComments, ReplyToReviewComment } from '../../gadgets/github/index.js';
import type { Capability } from '../capabilities/index.js';
import { buildGadgetsFromCapabilities as buildFromCapabilities } from '../capabilities/resolver.js';

// Re-export the main capability-based building function
export { buildGadgetsFromCapabilities } from '../capabilities/resolver.js';

/**
 * Build gadgets from capabilities with optional special handling.
 *
 * This function adds gadgets for special options that aren't capability-driven:
 * - includeReviewComments: adds GetPRComments and ReplyToReviewComment
 */
export function buildGadgetsForAgent(
	capabilities: Capability[],
	options?: {
		/** Include GetPRComments and ReplyToReviewComment (for PR comment response agents) */
		includeReviewComments?: boolean;
	},
): unknown[] {
	const gadgets = buildFromCapabilities(capabilities);

	// Add review comment tools if requested (not capability-driven, agent-specific)
	if (options?.includeReviewComments) {
		// Check if not already included via scm:comment capability
		const hasScmComment = capabilities.includes('scm:comment');
		if (!hasScmComment) {
			gadgets.push(new GetPRComments(), new ReplyToReviewComment());
		}
	}

	return gadgets;
}
