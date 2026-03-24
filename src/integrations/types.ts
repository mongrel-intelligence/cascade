/**
 * IntegrationModule — the category-agnostic contract that every integration
 * (PM, SCM, Alerting) must implement.
 *
 * This is the foundational interface for the unified integration abstraction
 * layer. All integration types share this common contract, enabling the
 * IntegrationRegistry to manage them without category-specific branching.
 */

import type { IntegrationCategory } from '../config/integrationRoles.js';
import type { CascadeConfig, ProjectConfig } from '../types/index.js';

/**
 * Normalized webhook event — what the generic webhook handler operates on
 * at the integration level.
 */
export interface IntegrationWebhookEvent {
	/** Provider-specific event type (e.g. 'updateCard', 'jira:issue_updated', 'push') */
	eventType: string;
	/** Provider-specific identifier for matching a project */
	projectIdentifier: string;
	/** Work item ID when available */
	workItemId?: string;
	/** Original payload, passed to trigger dispatch */
	raw: unknown;
}

/**
 * IntegrationModule — the unified interface all integrations must implement.
 *
 * Required methods:
 * - `type`: Unique provider identifier (e.g. 'trello', 'github', 'sentry')
 * - `category`: Which category this integration belongs to
 * - `withCredentials()`: Run a function within the credential scope for a project
 * - `hasIntegration()`: Check if a project has this integration configured with all required credentials
 *
 * Optional webhook methods are implemented by integrations that receive webhooks.
 */
export interface IntegrationModule {
	/** Provider identifier — matches the string stored in project_integrations.provider */
	readonly type: string;

	/** Integration category — determines which capability group this belongs to */
	readonly category: IntegrationCategory;

	/**
	 * Resolve credentials from DB and run `fn` within the credential scope.
	 * Implementations should set the necessary env vars before calling `fn`
	 * and clean up afterwards.
	 */
	withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T>;

	/**
	 * Check if this integration is configured for a project.
	 * Returns true if all required credentials are present.
	 */
	hasIntegration(projectId: string): Promise<boolean>;

	// --- Optional webhook methods ---

	/**
	 * Parse a raw webhook body into a normalized event, or null if irrelevant.
	 * Implemented by integrations that receive webhooks.
	 */
	parseWebhookPayload?(raw: unknown): IntegrationWebhookEvent | null;

	/**
	 * Check if a webhook event was authored by the integration's own bot account.
	 * Implemented by integrations that need to filter self-authored events.
	 */
	isSelfAuthored?(event: IntegrationWebhookEvent, projectId: string): Promise<boolean>;

	/**
	 * Find the project config + cascade config from a webhook identifier.
	 * Implemented by integrations that need to route webhooks to projects.
	 */
	lookupProject?(
		identifier: string,
	): Promise<{ project: ProjectConfig; config: CascadeConfig } | null>;

	/**
	 * Extract a work item ID from text (e.g. PR body).
	 * Returns null if not found.
	 * Implemented by integrations that support cross-referencing work items.
	 */
	extractWorkItemId?(text: string): string | null;
}
