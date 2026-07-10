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
	/**
	 * Optional JIRA authentication mode (non-secret config, mirrors `baseUrl`).
	 * `'basic'` = classic site-token mode; `'scoped'` = scoped gateway-token
	 * mode. Absent ⇒ treated as `'basic'`. Later stories consume this field.
	 */
	authType?: 'basic' | 'scoped';
	statuses: Record<string, string>;
	issueTypes?: Record<string, string>;
	customFields?: { cost?: string };
	labels?: {
		processing?: string;
		processed?: string;
		error?: string;
		readyToProcess?: string;
		auto?: string;
		/** JIRA label name applied to alert work items (spec 019). */
		cascadeAlert?: string;
		/** JIRA label name applied to friction work items (2026-05-10). */
		cascadeFriction?: string;
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
	/** Optional Linear Project (initiative) ID that narrows scope within the team. */
	projectId?: string;
	statuses: Record<string, string>;
	labels?: {
		processing?: string;
		processed?: string;
		error?: string;
		readyToProcess?: string;
		auto?: string;
		/** Linear label UUID applied to alert work items (spec 019). */
		cascadeAlert?: string;
		/** Linear label UUID applied to friction work items (2026-05-10). */
		cascadeFriction?: string;
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
 * Get the cost custom field ID for a project, regardless of PM type.
 */
export function getCostFieldId(project: ProjectConfig): string | undefined {
	if (project.pm?.type === 'jira') {
		return getJiraConfig(project)?.customFields?.cost;
	}
	if (project.pm?.type === 'linear') {
		return getLinearConfig(project)?.customFields?.cost;
	}
	return getTrelloConfig(project)?.customFields?.cost;
}

/**
 * Returns the container ID the PM adapter's `createWorkItem.containerId` expects
 * for placing alert work items:
 *   - Trello → `lists.alerts` (the list ID the card will be created in)
 *   - JIRA   → `projectKey` (JIRA issues are always scoped to a project; the
 *              alerts *status* is applied afterwards via a lifecycle move)
 *   - Linear → `teamId` (same asymmetry as JIRA: the team is the container;
 *              the alerts state is applied via a follow-up move)
 *
 * Returns `undefined` when the project has no PM config or the alerts slot
 * is not configured:
 *   - Trello: `lists.alerts` absent → undefined
 *   - JIRA:   `statuses.alerts` absent → undefined (prevents creating issues in
 *             the wrong state before validation fails)
 *   - Linear: `statuses.alerts` absent → undefined (same reasoning as JIRA)
 */
export function getAlertsContainerId(project: ProjectConfig): string | undefined {
	const pmType = project.pm?.type;
	if (pmType === 'trello') {
		return getTrelloConfig(project)?.lists?.alerts;
	}
	if (pmType === 'jira') {
		const jiraConfig = getJiraConfig(project);
		// Require statuses.alerts to be configured: without it the issue would be
		// created in the project's default state and fail pre-flight validation later,
		// leaving an alert work item outside the required alerts slot.
		if (!jiraConfig?.statuses?.alerts) return undefined;
		return jiraConfig.projectKey;
	}
	if (pmType === 'linear') {
		const linearConfig = getLinearConfig(project);
		// Same guard as JIRA: the alerts workflow state must be configured before
		// we allow issue creation.
		if (!linearConfig?.statuses?.alerts) return undefined;
		return linearConfig.teamId;
	}
	return undefined;
}

/**
 * Returns the container ID the PM adapter's `createWorkItem.containerId` expects
 * for placing friction report work items:
 *   - Trello → `lists.friction` (the list ID the card will be created in)
 *   - JIRA   → `projectKey` when `statuses.friction` is configured
 *   - Linear → `teamId` when `statuses.friction` is configured
 *
 * Returns `undefined` when the project has no PM config or the friction slot
 * is not configured.
 */
export function getFrictionContainerId(project: ProjectConfig): string | undefined {
	const pmType = project.pm?.type;
	if (pmType === 'trello') {
		return getTrelloConfig(project)?.lists?.friction;
	}
	if (pmType === 'jira') {
		const jiraConfig = getJiraConfig(project);
		if (!jiraConfig?.statuses?.friction) return undefined;
		return jiraConfig.projectKey;
	}
	if (pmType === 'linear') {
		const linearConfig = getLinearConfig(project);
		if (!linearConfig?.statuses?.friction) return undefined;
		return linearConfig.teamId;
	}
	return undefined;
}

/**
 * Returns the label identifier to apply to an alert work item:
 *   - Trello → `labels['cascade-alert']` (Trello label ID)
 *   - JIRA   → `labels.cascadeAlert` (JIRA label name string)
 *   - Linear → `labels.cascadeAlert` (Linear label UUID)
 *
 * Returns `undefined` when the label slot is not configured.
 */
export function getAlertLabelId(project: ProjectConfig): string | undefined {
	const pmType = project.pm?.type;
	if (pmType === 'trello') {
		return getTrelloConfig(project)?.labels?.['cascade-alert'];
	}
	if (pmType === 'jira') {
		return getJiraConfig(project)?.labels?.cascadeAlert;
	}
	if (pmType === 'linear') {
		return getLinearConfig(project)?.labels?.cascadeAlert;
	}
	return undefined;
}

/**
 * Returns the label identifier to apply to a friction work item:
 *   - Trello → `labels['cascade-friction']` (Trello label ID)
 *   - JIRA   → `labels.cascadeFriction` (JIRA label name string)
 *   - Linear → `labels.cascadeFriction` (Linear label UUID)
 *
 * Returns `undefined` when the label slot is not configured. Mirrors the
 * `getAlertLabelId` opt-in pattern from spec 019: operators add the label
 * to PM integration config when they want filtering/clustering on friction
 * cards; absent config means cards file unlabeled and behavior is unchanged.
 */
export function getFrictionLabelId(project: ProjectConfig): string | undefined {
	const pmType = project.pm?.type;
	if (pmType === 'trello') {
		return getTrelloConfig(project)?.labels?.['cascade-friction'];
	}
	if (pmType === 'jira') {
		return getJiraConfig(project)?.labels?.cascadeFriction;
	}
	if (pmType === 'linear') {
		return getLinearConfig(project)?.labels?.cascadeFriction;
	}
	return undefined;
}

/**
 * Returns the literal `'alerts'` status key when the project's PM config
 * has the alerts slot populated, otherwise `undefined`.
 *
 * The materializer feeds this into `lifecycle.moveTo(statusKey)` to move
 * the newly created work item into the configured alerts state.
 *   - Trello  → truthy when `lists.alerts` is set
 *   - JIRA    → truthy when `statuses.alerts` is set
 *   - Linear  → truthy when `statuses.alerts` is set
 */
export function getAlertsStatusKey(project: ProjectConfig): 'alerts' | undefined {
	const pmType = project.pm?.type;
	if (pmType === 'trello') {
		return getTrelloConfig(project)?.lists?.alerts ? 'alerts' : undefined;
	}
	if (pmType === 'jira') {
		return getJiraConfig(project)?.statuses?.alerts ? 'alerts' : undefined;
	}
	if (pmType === 'linear') {
		return getLinearConfig(project)?.statuses?.alerts ? 'alerts' : undefined;
	}
	return undefined;
}

/**
 * Returns the actual destination value to pass to `provider.moveWorkItem` for the
 * alerts slot. This is different from `getAlertsContainerId`:
 *   - Trello  → `lists.alerts` (list ID — same as containerId; card is placed there on create,
 *              the moveWorkItem call is a no-op but kept for uniformity)
 *   - JIRA    → `statuses.alerts` (transition name/ID; applied after issue creation)
 *   - Linear  → `statuses.alerts` (workflow state UUID; applied after issue creation)
 *
 * Returns `undefined` when the alerts slot is not configured.
 */
export function getAlertsStatusDestination(project: ProjectConfig): string | undefined {
	const pmType = project.pm?.type;
	if (pmType === 'trello') {
		return getTrelloConfig(project)?.lists?.alerts;
	}
	if (pmType === 'jira') {
		return getJiraConfig(project)?.statuses?.alerts;
	}
	if (pmType === 'linear') {
		return getLinearConfig(project)?.statuses?.alerts;
	}
	return undefined;
}

/**
 * Returns the actual destination value to pass to `provider.moveWorkItem` for the
 * friction slot:
 *   - Trello  → `lists.friction`
 *   - JIRA    → `statuses.friction`
 *   - Linear  → `statuses.friction`
 *
 * Returns `undefined` when the friction slot is not configured.
 */
export function getFrictionStatusDestination(project: ProjectConfig): string | undefined {
	const pmType = project.pm?.type;
	if (pmType === 'trello') {
		return getTrelloConfig(project)?.lists?.friction;
	}
	if (pmType === 'jira') {
		return getJiraConfig(project)?.statuses?.friction;
	}
	if (pmType === 'linear') {
		return getLinearConfig(project)?.statuses?.friction;
	}
	return undefined;
}
