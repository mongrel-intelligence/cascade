/**
 * GitLab trigger registration.
 *
 * This module only imports trigger handler classes (no webhook handlers,
 * no agent execution pipeline) so it is safe to import from the router.
 *
 * `registerGitLabTriggers` is the single call-site for wiring all built-in
 * GitLab triggers into a registry. Adding a new GitLab trigger only
 * requires updating this file, not `builtins.ts`.
 */

import type { TriggerRegistry } from '../registry.js';
import { MRApprovalTrigger } from './mr-approval.js';
import { MRCommentMentionTrigger } from './mr-comment-mention.js';
import { MRConflictDetectedTrigger } from './mr-conflict-detected.js';
import { MRMergedTrigger } from './mr-merged.js';
import { MROpenedTrigger } from './mr-opened.js';
import { MRReadyToMergeTrigger } from './mr-ready-to-merge.js';
import { MRReviewerAddedTrigger } from './mr-reviewer-added.js';
import { PipelineFailureTrigger } from './pipeline-failure.js';
import { PipelineSuccessTrigger } from './pipeline-success.js';

/**
 * Register all built-in GitLab triggers into the given registry.
 *
 * Order matters:
 * - MRCommentMentionTrigger before MRApprovalTrigger (intercept mentions first)
 * - MRConflictDetectedTrigger before PipelineSuccessTrigger (handle conflicts first)
 * - PipelineSuccessTrigger before MRReadyToMergeTrigger (review before moving to DONE)
 */
export function registerGitLabTriggers(registry: TriggerRegistry): void {
	// Opt-in: disabled by default via trigger config
	registry.register(new MROpenedTrigger());

	// Must be registered before other comment triggers
	registry.register(new MRCommentMentionTrigger());

	registry.register(new MRApprovalTrigger());

	// Opt-in: disabled by default via trigger config (scm:review-requested)
	registry.register(new MRReviewerAddedTrigger());

	registry.register(new PipelineFailureTrigger());
	registry.register(new MRConflictDetectedTrigger());
	registry.register(new PipelineSuccessTrigger());
	registry.register(new MRReadyToMergeTrigger());
	registry.register(new MRMergedTrigger());
}
