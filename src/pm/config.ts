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

/**
 * Get the cost custom field ID for a project, regardless of PM type.
 */
export function getCostFieldId(project: ProjectConfig): string | undefined {
	if (project.pm?.type === 'jira') {
		return getJiraConfig(project)?.customFields?.cost;
	}
	return getTrelloConfig(project)?.customFields?.cost;
}
