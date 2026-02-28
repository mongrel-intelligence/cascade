/**
 * GitHub trigger registration.
 *
 * This module only imports trigger handler classes (no webhook handlers,
 * no agent execution pipeline) so it is safe to import from the router.
 *
 * `registerGitHubTriggers` is the single call-site for wiring all built-in
 * GitHub triggers into a registry. Adding a new GitHub trigger only
 * requires updating this file, not `builtins.ts`.
 */

import type { TriggerRegistry } from '../registry.js';
import { CheckSuiteFailureTrigger } from './check-suite-failure.js';
import { CheckSuiteSuccessTrigger } from './check-suite-success.js';
import { PRCommentMentionTrigger } from './pr-comment-mention.js';
import { PRMergedTrigger } from './pr-merged.js';
import { PROpenedTrigger } from './pr-opened.js';
import { PRReadyToMergeTrigger } from './pr-ready-to-merge.js';
import { PRReviewSubmittedTrigger } from './pr-review-submitted.js';
import { ReviewRequestedTrigger } from './review-requested.js';

/**
 * Register all built-in GitHub triggers into the given registry.
 *
 * Order matters:
 * - PRCommentMentionTrigger before PRReviewSubmittedTrigger (intercept mentions first)
 * - ReviewRequestedTrigger before CheckSuiteSuccessTrigger (both can independently trigger review)
 */
export function registerGitHubTriggers(registry: TriggerRegistry): void {
	// Opt-in: disabled by default via trigger config (github.triggers.prOpened = false)
	registry.register(new PROpenedTrigger());

	// Must be registered before other comment triggers
	registry.register(new PRCommentMentionTrigger());

	registry.register(new PRReviewSubmittedTrigger());

	// Opt-in: disabled by default via trigger config (github.triggers.reviewRequested = false)
	// Registered before CheckSuiteSuccessTrigger so both can independently trigger review
	registry.register(new ReviewRequestedTrigger());

	registry.register(new CheckSuiteFailureTrigger());
	registry.register(new CheckSuiteSuccessTrigger());
	registry.register(new PRReadyToMergeTrigger());
	registry.register(new PRMergedTrigger());
}
