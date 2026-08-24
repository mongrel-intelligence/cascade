/**
 * RouterPlatformAdapter interface — per-platform pluggable behavior for the
 * generic `processRouterWebhook()` pipeline.
 *
 * Mirrors the `PMIntegration` pattern from `pm/webhook-handler.ts` but for
 * the router-side (multi-container) deployment mode where the goal is to
 * quickly filter, acknowledge, and enqueue — not to execute agents inline.
 */

import type { TriggerRegistry } from '../triggers/registry.js';
import type { TriggerResult } from '../types/index.js';
import type { RouterProjectConfig } from './config.js';
import type { CascadeJob } from './queue.js';

// ---------------------------------------------------------------------------
// Ack result — returned from postAck, threaded through to buildJob
// ---------------------------------------------------------------------------

/**
 * Result of posting an acknowledgment comment. Carries both the comment ID
 * (for ProgressMonitor to update in-place) and the message text (for agents
 * that need the ack content, e.g. GitHub's ackMessage in worker-entry).
 */
export interface AckResult {
	commentId?: string | number;
	message?: string;
}

// ---------------------------------------------------------------------------
// Parsed webhook event — normalized across platforms
// ---------------------------------------------------------------------------

/**
 * Common fields extracted from an incoming webhook payload.
 * Each adapter fills only the fields relevant to its platform.
 */
export interface ParsedWebhookEvent {
	/** Canonical identifier used for project lookup (board ID, repo name, JIRA project key). */
	projectIdentifier: string;

	/** Human-readable event descriptor (action type, event name, webhook event string). */
	eventType: string;

	/** Primary work-item identifier (card ID, PR number as string, issue key). */
	workItemId?: string;

	/** Whether this is a comment/mention event that may need an acknowledgment reaction. */
	isCommentEvent: boolean;

	/** Platform-specific unique action ID for deduplication (e.g., Trello action.id). */
	actionId?: string;
}

// ---------------------------------------------------------------------------
// RouterPlatformAdapter interface
// ---------------------------------------------------------------------------

/**
 * Outcome of project resolution when the adapter can explain a miss.
 *
 * A miss is not always "unknown identifier": once projects can share one, an
 * event may match none of them, and the operator needs to know which candidates
 * were evaluated and why each was rejected.
 */
export type ProjectResolution =
	| { project: RouterProjectConfig; reason?: undefined }
	| { project: null; reason: string };

export interface RouterPlatformAdapter {
	/** Platform identifier — used in log messages. */
	readonly type: string;

	/**
	 * Parse the raw webhook body into a normalized `ParsedWebhookEvent`.
	 * Returns `null` if the payload is invalid or unsupported.
	 */
	parseWebhook(payload: unknown): Promise<ParsedWebhookEvent | null>;

	/**
	 * Return `true` if this event type is one the platform processes.
	 * Events that return `false` are logged and discarded early.
	 */
	isProcessableEvent(event: ParsedWebhookEvent): boolean;

	/**
	 * Return `true` if the event was authored by the platform bot itself.
	 * Used to prevent self-triggered loops on comment events.
	 */
	isSelfAuthored(event: ParsedWebhookEvent, payload: unknown): Promise<boolean>;

	/**
	 * Fire the acknowledgment reaction (👀) for a comment event.
	 * Must be fire-and-forget — callers do not await errors.
	 */
	sendReaction(event: ParsedWebhookEvent, payload: unknown): void;

	/**
	 * Resolve full project config for the event's project identifier.
	 * Returns `null` when no project is found.
	 */
	resolveProject(event: ParsedWebhookEvent): Promise<RouterProjectConfig | null>;

	/**
	 * Resolve the project AND, on a miss, say why (spec 024).
	 *
	 * `resolveProject` can only answer "no project", which the processor turns
	 * into a fixed `No project config for identifier X` — true when the
	 * identifier is unknown, but actively misleading once several projects can
	 * share one identifier and the event simply matched none of them.
	 *
	 * Optional by design: adapters that never share an identifier keep their
	 * existing behaviour with no change, and the processor falls back to
	 * `resolveProject` plus the original message.
	 */
	resolveProjectWithReason?(event: ParsedWebhookEvent): Promise<ProjectResolution>;

	/**
	 * Run the authoritative trigger dispatch inside platform credential scope.
	 * The adapter wraps `triggerRegistry.dispatch(ctx)` with appropriate
	 * `withXxxCredentials()` / `withGitHubToken()` calls.
	 */
	dispatchWithCredentials(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		triggerRegistry: TriggerRegistry,
	): Promise<TriggerResult | null>;

	/**
	 * Post an acknowledgment comment on the work item.
	 * Returns an `AckResult` with the comment ID and message text,
	 * or `undefined` on failure.
	 *
	 * The optional `triggerResult` parameter provides additional context (e.g. workItemId)
	 * that some adapters (e.g. GitHub) need to route ack comments for PM-focused agents.
	 */
	postAck(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		agentType: string,
		triggerResult?: TriggerResult,
	): Promise<AckResult | undefined>;

	/**
	 * Build the `CascadeJob` to be enqueued.
	 * The `ackResult` is available at build time (ack is posted before enqueue),
	 * so `ackCommentId` and `ackMessage` can be embedded directly in the job.
	 */
	buildJob(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		result: TriggerResult,
		ackResult?: AckResult,
	): CascadeJob;

	/**
	 * Optional: fire non-blocking pre-actions before the job is queued.
	 * (e.g. GitHub 👀 reaction on check_suite success)
	 */
	firePreActions?(job: CascadeJob, payload: unknown): void;
}
