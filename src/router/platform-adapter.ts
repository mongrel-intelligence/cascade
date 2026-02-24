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
}

// ---------------------------------------------------------------------------
// RouterPlatformAdapter interface
// ---------------------------------------------------------------------------

export interface RouterPlatformAdapter {
	/** Platform identifier — used in log messages. */
	readonly type: 'trello' | 'github' | 'jira';

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
	 * Returns the comment ID (platform-specific type) or `undefined` on failure.
	 */
	postAck(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		agentType: string,
	): Promise<string | number | undefined>;

	/**
	 * Build the `CascadeJob` to be enqueued.
	 */
	buildJob(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		result: TriggerResult,
		ackCommentId: string | number | undefined,
	): CascadeJob;

	/**
	 * Optional: fire non-blocking pre-actions before the job is queued.
	 * (e.g. GitHub 👀 reaction on check_suite success)
	 */
	firePreActions?(job: CascadeJob, payload: unknown): void;
}
