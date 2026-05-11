import type { z } from 'zod';
import type { CascadeConfigSchema, ProjectConfigSchema } from '../config/schema.js';
import type { PersonaIdentities } from '../github/personas.js';
import type { CanonicalTriggerEvent } from '../triggers/shared/events.js';

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type CascadeConfig = z.infer<typeof CascadeConfigSchema>;

export interface AgentInput {
	workItemId?: string;
	prNumber?: number;
	repoDir?: string;

	// PR context fields — populated by trigger handlers from webhook payload
	prBranch?: string;
	repoFullName?: string;
	/**
	 * The PR's head SHA at trigger time. Sourced from `pull_request.head.sha` (or
	 * `check_suite.head_sha` for check-failure events). Used both for the original
	 * check-failure flow AND for post-checkout HEAD verification in `setupRepository`.
	 */
	headSha?: string;
	triggerType?:
		| 'check-failure'
		| 'feature-implementation'
		| 'ci-success'
		| 'review-requested'
		| 'pr-opened'
		| 'conflict-resolution'
		| 'manual';

	/** YAML-format trigger event name for context pipeline resolution (e.g. 'scm:check-suite-success') */
	triggerEvent?: CanonicalTriggerEvent | (string & {});

	// Debug agent fields
	logDir?: string;
	originalWorkItemId?: string;
	originalWorkItemName?: string;
	originalWorkItemUrl?: string;
	detectedAgentType?: string;

	// Unified comment trigger fields — both PM (Trello/JIRA/Linear) and SCM (GitHub) triggers use these
	/** The body text of the triggering comment. Canonical field for all comment-mention triggers. */
	triggerCommentBody?: string;
	triggerCommentPath?: string;
	triggerCommentAuthor?: string;

	/**
	 * @deprecated Use `triggerCommentBody` instead.
	 * Retained for one release as a backward-compatible alias. PM comment-mention
	 * triggers populate both fields with the same value.
	 */
	triggerCommentText?: string;

	// Interactive mode (local development)
	interactive?: boolean;
	// Auto-accept prompts in interactive mode
	autoAccept?: boolean;
	// Override the model for this agent run
	modelOverride?: string;

	// Router-posted ack comment ID — used by ProgressMonitor to update in-place
	ackCommentId?: string | number;
	// Router/webhook-handler-posted ack message text — reused as initial comment header
	ackMessage?: string;

	// Alerting fields
	alertIssueId?: string;
	alertOrgId?: string;
	alertTitle?: string;
	alertIssueUrl?: string;
	/**
	 * Stable key for metric alerts: `${orgSlug}:${alertTitle}`.
	 * Used as the externalId for the sentry-metric source in the PM materializer.
	 * Set by SentryMetricAlertTrigger; consumed by processSentryWebhook.
	 */
	alertMetricKey?: string;

	[key: string]: unknown;
}

export interface AgentResult {
	success: boolean;
	output: string;
	prUrl?: string;
	progressCommentId?: string;
	error?: string;
	logBuffer?: Buffer;
	cost?: number;
	runId?: string;
	durationMs?: number;
}

export type TriggerSource = string;

export interface TriggerContext {
	project: ProjectConfig;
	source: TriggerSource;
	payload: unknown;
	/** Resolved GitHub usernames for bot detection. Present for GitHub-sourced triggers. */
	personaIdentities?: PersonaIdentities;
}

export interface TriggerResult {
	agentType: string | null;
	agentInput: AgentInput;
	workItemId?: string;
	/** URL to the work item in the PM provider (e.g. Trello card URL, Jira issue URL). */
	workItemUrl?: string;
	/** Display title of the work item (e.g. Trello card name, Jira issue summary). */
	workItemTitle?: string;
	prNumber?: number;
	/** URL to the pull request (e.g. https://github.com/owner/repo/pull/123). */
	prUrl?: string;
	/** Display title of the pull request. */
	prTitle?: string;
	/** Called when the router cannot enqueue the job (work-item lock, concurrency limit).
	 *  Allows the trigger handler to undo side-effects like dedup marking. */
	onBlocked?: () => void;
	/**
	 * Router-level work-item lock key, independent of `workItemId`.
	 *
	 * Set by trigger handlers that defer `workItemId` assignment to the worker
	 * (e.g. Sentry issue/metric alert triggers that materialise the PM card on
	 * the worker side). The router uses `lockKey ?? workItemId` for
	 * `isWorkItemLocked` / `markWorkItemEnqueued` / `clearWorkItemEnqueued` so
	 * that duplicate webhook deliveries are rejected even before the PM card ID
	 * is known.
	 *
	 * Must be stable across deliveries for the same logical alert — e.g.
	 * `sentry:${issueId}` for Sentry issue alerts.
	 */
	lockKey?: string;
	/**
	 * Coalesce key for PM status-change webhook deduplication.
	 *
	 * Set on `pm:status-changed` triggers. When present, the router schedules
	 * the job as a BullMQ delayed job keyed by this value. Any subsequent
	 * event sharing the same key within the `PM_COALESCE_WINDOW_MS` window
	 * supersedes the prior pending dispatch — regardless of agent type or
	 * whether the event is a create vs. update.
	 *
	 * Typical key: `${projectId}:${workItemId}`.
	 */
	coalesceKey?: string;
	/**
	 * Structured self-skip signal — set when a matched handler decided NOT to
	 * dispatch an agent (e.g. all-checks-not-complete, attempt limit hit, PR
	 * not authored by a cascade persona). `agentType` MUST be `null` when
	 * `skipReason` is set.
	 *
	 * The router promotes `skipReason.message` into the persisted webhook log's
	 * `decisionReason` so operators can distinguish "no matcher matched" from
	 * "matcher claimed the event but bailed" without trawling cascade-router
	 * process logs. Bare `return null` from `handle()` keeps the legacy
	 * "try-next-handler" semantic; structured skips terminate dispatch.
	 */
	skipReason?: {
		/** Name of the handler that produced the skip (e.g. `'check-suite-failure'`). */
		handler: string;
		/** Human-readable explanation. Used verbatim in webhook log decisionReason. */
		message: string;
	};
	/**
	 * When set and `agentType` is `null`, the router schedules a coalesced bare
	 * delayed job via `scheduleCoalescedJob`. The router scheduling is
	 * adapter-agnostic, but **bare re-dispatch is currently GitHub-only**:
	 * `GitHubRouterAdapter.buildJob()` omits `triggerResult` from the job so the
	 * GitHub worker re-dispatches through the trigger registry for fresh provider
	 * state. Non-GitHub adapters (Trello, JIRA, Linear, Sentry) embed
	 * `triggerResult` in the job; their workers pass it to
	 * `resolveTriggerResult()`, which returns the pre-resolved `agentType: null`
	 * result without dispatching. Use this field only in GitHub handlers unless
	 * the adapter and worker for your provider have been updated to support bare
	 * re-dispatch.
	 */
	deferredRecheck?: {
		delayMs: number;
		coalesceKey: string;
		/**
		 * Distinguishes the type of deferred re-check so the router adapter can
		 * stamp the right job field and the worker can apply the right retry policy.
		 *
		 * - `'check-suite'` — Actions API was stale at first dispatch; the job gets
		 *   `checkSuiteRecheckAttempt: 1` and the worker reschedules safely on a
		 *   still-stale response (coalesceKey deduplication prevents queue flooding).
		 * - absent (undefined) — treated as a mergeability re-check; the job gets
		 *   `mergeabilityRecheckAttempt: 1` and the worker emits
		 *   `mergeability_recheck_exhausted` when the trigger is still indeterminate.
		 */
		recheckKind?: 'check-suite';
	};
}

export interface TriggerHandler {
	name: string;
	description: string;
	matches: (ctx: TriggerContext) => boolean;
	handle: (ctx: TriggerContext) => Promise<TriggerResult | null>;
}
