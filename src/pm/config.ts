/**
 * Type-safe accessor functions for provider-specific PM config.
 *
 * Instead of accessing `project.trello?.xxx` or `project.jira?.xxx` directly,
 * consumers use these accessors which extract the config from either the
 * unified `project.pm.config` or the legacy top-level fields.
 */

import type { ProjectConfig } from '../types/index.js';

/** Trello-specific configuration (from project_integrations JSONB) */
export interface TrelloConfig {
	boardId: string;
	lists: Record<string, string>;
	labels: Record<string, string>;
	customFields?: { cost?: string };
}

/** JIRA-specific configuration (from project_integrations JSONB) */
export interface JiraConfig {
	projectKey: string;
	baseUrl: string;
	statuses: Record<string, string>;
	issueTypes?: Record<string, string>;
	customFields?: { cost?: string };
	labels?: {
		processing?: string;
		processed?: string;
		error?: string;
		readyToProcess?: string;
		auto?: string;
	};
}

/**
 * Get the Trello config for a project.
 * Returns the config or undefined if this is not a Trello project.
 */
export function getTrelloConfig(project: ProjectConfig): TrelloConfig | undefined {
	if (project.pm?.type !== 'trello' && project.pm?.type !== undefined) return undefined;
	return project.trello as TrelloConfig | undefined;
}

/**
 * Get the JIRA config for a project.
 * Returns the config or undefined if this is not a JIRA project.
 *
 * Falls back to checking `project.jira` directly when `pm.type` is unset
 * (legacy projects / test fixtures that don't set `pm.type`).
 */
export function getJiraConfig(project: ProjectConfig): JiraConfig | undefined {
	if (project.pm?.type !== undefined && project.pm?.type !== 'jira') return undefined;
	return project.jira as JiraConfig | undefined;
}

/** Linear-specific configuration (from project_integrations JSONB) */
export interface LinearConfig {
	teamId: string;
	statuses: Record<string, string>;
	labels?: {
		processing?: string;
		processed?: string;
		error?: string;
		readyToProcess?: string;
		auto?: string;
	};
	customFields?: { cost?: string };
}

/**
 * Get the Linear config for a project.
 * Returns the config or undefined if this is not a Linear project.
 */
export function getLinearConfig(project: ProjectConfig): LinearConfig | undefined {
	if (project.pm?.type !== 'linear') return undefined;
	return project.linear as LinearConfig | undefined;
}

/**
 * Get the active PM provider's config as a generic record.
 *
 * Returns the `pmConfig` field when available (populated from `project_integrations.config`
 * via the configMapper). Falls back to the per-provider typed accessor for backward compat
 * with test fixtures and legacy projects that don't have `pmConfig` populated.
 *
 * Use the typed accessors (getTrelloConfig, getJiraConfig, getLinearConfig) when you need
 * provider-specific fields with compile-time type safety. Use this accessor for generic
 * operations that apply to all providers (e.g., extracting the cost field ID).
 */
export function getPMConfig(project: ProjectConfig): Record<string, unknown> | undefined {
	// Use the unified pmConfig field when available
	if (project.pmConfig) return project.pmConfig;

	// Fallback: derive from per-provider typed fields (backward compat)
	const pmType = project.pm?.type ?? 'trello';
	if (pmType === 'jira') return project.jira as Record<string, unknown> | undefined;
	if (pmType === 'linear') return project.linear as Record<string, unknown> | undefined;
	return project.trello as Record<string, unknown> | undefined;
}

/**
 * Get the cost custom field ID for a project, regardless of PM type.
 *
 * Delegates to getPMConfig() which already handles both the unified pmConfig
 * field and the per-provider fallback (trello/jira/linear), so no additional
 * branching is needed here.
 */
export function getCostFieldId(project: ProjectConfig): string | undefined {
	const pmConfig = getPMConfig(project);
	const customFields = pmConfig?.customFields as { cost?: string } | undefined;
	return customFields?.cost;
}
