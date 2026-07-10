import { z } from 'zod';

/**
 * Review-event-policy catalog — the single source of truth for *which* review
 * verdicts a CASCADE review agent may submit on a GitHub pull request.
 *
 * | policy         | APPROVE | REQUEST_CHANGES | COMMENT |
 * |----------------|:-------:|:---------------:|:-------:|
 * | `all`          |   ✅    |       ✅        |   ✅    |
 * | `comment-only` |   ❌    |       ❌        |   ✅    |
 *
 * Under `comment-only`, the agent still chooses its true verdict and passes it
 * as the `event` parameter of CreatePRReview — the tool layer deterministically
 * downgrades the submission to a non-blocking COMMENT review whose body leads
 * with a human-readable advisory verdict line ({@link buildAdvisoryPreamble}).
 * Developers keep approval authority; the agent contributes information only.
 *
 * The default is `all`, which preserves the historical behavior where the
 * review agent approves or requests changes itself.
 *
 * This module is intentionally pure and dependency-free (Zod only) — the same
 * contract as `src/config/updateChannel.ts`. Wiring into config mapping, the
 * DB, the API, the CLI, or the UI happens elsewhere; everything imports the
 * policy semantics from here so they have exactly one home.
 */
export const REVIEW_EVENT_POLICIES = ['all', 'comment-only'] as const;

/** A single review-event-policy value. */
export type ReviewEventPolicy = (typeof REVIEW_EVENT_POLICIES)[number];

/** Policy used when a project / agent does not specify one. */
export const DEFAULT_REVIEW_EVENT_POLICY: ReviewEventPolicy = 'all';

/** Zod enum for validating persisted / API-supplied policy values. */
export const ReviewEventPolicySchema = z.enum(REVIEW_EVENT_POLICIES);

/**
 * Worker env var carrying the resolved policy to `cascade-tools` subprocesses
 * (the native-tool engine path). Injected only when the policy is
 * `comment-only`; absence means {@link DEFAULT_REVIEW_EVENT_POLICY}. In-process
 * gadget runs (LLMist) resolve the policy from SessionState instead.
 */
export const REVIEW_EVENT_POLICY_ENV_VAR = 'CASCADE_REVIEW_EVENT_POLICY';

/**
 * Policy file written by the worker process before the agent starts. Used as a
 * fallback when {@link REVIEW_EVENT_POLICY_ENV_VAR} is stripped by the claude
 * subprocess chain (observed with @anthropic-ai/claude-code ≤ 2.1.185 — the
 * bun-compiled binary does not forward all custom env vars to bash subprocesses).
 * The path is fixed inside the ephemeral worker container's /tmp, so there is no
 * cross-run collision.
 */
export const REVIEW_EVENT_POLICY_FILE = '/tmp/cascade-review-event-policy';

/** The GitHub pull-request review event types CreatePRReview can submit. */
export const REVIEW_EVENTS = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] as const;

/** A single GitHub review event type. */
export type ReviewEvent = (typeof REVIEW_EVENTS)[number];

/**
 * Minimal structural shape that {@link resolveReviewEventPolicy} reads from a
 * project — structurally compatible with `ProjectConfig`.
 */
export interface ProjectWithReviewEventPolicies {
	/** Per-agent-type policy overrides, keyed by agent type. */
	agentReviewEventPolicies?: Record<string, ReviewEventPolicy | undefined>;
}

/**
 * Resolve the review event policy for a given agent type on a project.
 *
 * Reads `project.agentReviewEventPolicies?.[agentType]` and falls back to
 * {@link DEFAULT_REVIEW_EVENT_POLICY} (`all`) when the project has no map, no
 * entry for the agent type, or an `undefined` entry.
 */
export function resolveReviewEventPolicy(
	project: ProjectWithReviewEventPolicies,
	agentType: string,
): ReviewEventPolicy {
	return project.agentReviewEventPolicies?.[agentType] ?? DEFAULT_REVIEW_EVENT_POLICY;
}

/** True when the policy restricts review submissions to COMMENT events. */
export function isCommentOnlyReview(policy: ReviewEventPolicy): boolean {
	return policy === 'comment-only';
}

/** Human-readable verdict wording for the advisory preamble, per event. */
const ADVISORY_VERDICT_LABELS: Record<ReviewEvent, string> = {
	APPROVE: 'would approve',
	REQUEST_CHANGES: 'would request changes',
	COMMENT: 'comment',
};

/**
 * Build the human-readable advisory line prepended to a comment-only review
 * body. Purely informational for the developers reading the review — nothing
 * in CASCADE parses it back out (internal decisions use config checks).
 */
export function buildAdvisoryPreamble(event: ReviewEvent): string {
	return `**Advisory verdict: ${ADVISORY_VERDICT_LABELS[event]}** _(comment-only review mode — this review does not block merging)_`;
}

/** Result of applying a review event policy to a pending review submission. */
export interface AppliedReviewEventPolicy {
	/** The event to actually submit to GitHub. */
	event: ReviewEvent;
	/** The body to actually submit (advisory-preamble-led under comment-only). */
	body: string;
	/** The agent's original verdict, present only when the policy downgraded it. */
	advisoryEvent?: ReviewEvent;
}

/**
 * Apply a review event policy to a pending review submission.
 *
 * - `all` — identity: the requested event and body pass through untouched.
 * - `comment-only` — every event (including a genuine COMMENT) is downgraded
 *   to `COMMENT` and the body gains the advisory preamble, so the submitted
 *   review can never approve or block the PR.
 */
export function applyReviewEventPolicy(
	event: ReviewEvent,
	body: string,
	policy: ReviewEventPolicy,
): AppliedReviewEventPolicy {
	if (!isCommentOnlyReview(policy)) {
		return { event, body };
	}
	return {
		event: 'COMMENT',
		body: `${buildAdvisoryPreamble(event)}\n\n${body}`,
		advisoryEvent: event,
	};
}
