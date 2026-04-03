/**
 * PMIntegration — the higher-level contract that encapsulates everything a PM
 * provider needs: data operations, credential scoping, webhook parsing,
 * router-side operations, config resolution, and trigger registration.
 *
 * Each PM provider (Trello, JIRA, future ClickUp/Linear) implements this
 * interface as a single self-contained class. Generic infrastructure (router,
 * webhook handler, lifecycle manager) consumes the interface without
 * provider-specific branching.
 *
 * Extends IntegrationModule so PM providers participate in the unified registry.
 */

import type { IntegrationModule } from '../integrations/types.js';
import type { AgentExecutionConfig } from '../triggers/shared/agent-execution.js';
import type { CascadeConfig, ProjectConfig } from '../types/index.js';
import type { ProjectPMConfig } from './lifecycle.js';
import type { PMProvider } from './types.js';

/**
 * Normalized webhook event — what the generic webhook handler operates on.
 */
export interface PMWebhookEvent {
	/** Provider-specific event type (e.g. 'updateCard', 'jira:issue_updated') */
	eventType: string;
	/** Provider-specific identifier for matching a project (boardId, projectKey) */
	projectIdentifier: string;
	/** Work item ID when available (workItemId, issueKey) */
	workItemId?: string;
	/** Original payload, passed to trigger dispatch */
	raw: unknown;
}

export interface PMIntegration extends IntegrationModule {
	/** Provider identifier — matches the string stored in project_integrations.provider */
	readonly type: string;

	/** Integration category — always 'pm' for PM providers */
	readonly category: 'pm';

	/**
	 * Check if this PM integration is configured for a project.
	 * Returns true if all required credentials are present.
	 */
	hasIntegration(projectId: string): Promise<boolean>;

	// --- Data operations ---
	/** Create a PMProvider instance from the project config */
	createProvider(project: ProjectConfig): PMProvider;

	// --- Credential lifecycle ---
	/** Resolve credentials from DB and run `fn` within the credential scope */
	withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T>;

	// --- Config ---
	/** Extract normalized lifecycle config (labels, statuses) from provider-specific config */
	resolveLifecycleConfig(project: ProjectConfig): ProjectPMConfig;

	/**
	 * Optional: Provide source-specific AgentExecutionConfig overrides.
	 * Used by GitHub to skip PM lifecycle steps (since GitHub agents are PR-based, not card-based).
	 */
	resolveExecutionConfig?(): AgentExecutionConfig;

	// --- Webhook processing ---
	/** Parse a raw webhook body into a normalized event, or null if irrelevant */
	parseWebhookPayload(raw: unknown): PMWebhookEvent | null;

	/** Check if a webhook event was authored by the integration's own bot account */
	isSelfAuthored(event: PMWebhookEvent, projectId: string): Promise<boolean>;

	// --- Router-side operations (lightweight, no SDK) ---
	/** Post an acknowledgment comment; returns comment ID or null on failure */
	postAckComment(projectId: string, workItemId: string, message: string): Promise<string | null>;

	/** Delete an acknowledgment comment (cleanup on no-match) */
	deleteAckComment(projectId: string, workItemId: string, commentId: string): Promise<void>;

	/** Send an acknowledgment reaction (e.g. 👀 emoji) on the source event */
	sendReaction(projectId: string, event: PMWebhookEvent): Promise<void>;

	// --- Project lookup ---
	/** Find the project config + cascade config from a webhook identifier */
	lookupProject(
		identifier: string,
	): Promise<{ project: ProjectConfig; config: CascadeConfig } | null>;

	// --- Work item ID extraction ---
	/** Extract a work item ID from text (e.g. PR body). Returns null if not found. */
	extractWorkItemId(text: string): string | null;
}
