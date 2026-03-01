/**
 * Trigger configuration resolver.
 * Merges agent definition defaults with project-specific overrides from the database.
 */

import { resolveAgentDefinition } from '../agents/definitions/index.js';
import type { SupportedTrigger } from '../agents/definitions/schema.js';
import {
	type AgentTriggerConfig,
	getTriggerConfig,
	getTriggerConfigsByProjectAndAgent,
} from '../db/repositories/agentTriggerConfigsRepository.js';

// ============================================================================
// Types
// ============================================================================

export interface ResolvedTriggerConfig {
	/** Trigger event identifier (e.g., 'pm:card-moved') */
	event: string;
	/** Human-readable label */
	label: string;
	/** Description for help text */
	description?: string;
	/** Whether this trigger is enabled */
	enabled: boolean;
	/** Resolved parameters (defaults merged with overrides) */
	parameters: Record<string, unknown>;
	/** Provider filter (e.g., ['trello']) */
	providers?: string[];
	/** Whether this config has been customized (has DB override) */
	isCustomized: boolean;
}

// ============================================================================
// Resolution Functions
// ============================================================================

/**
 * Resolve all trigger configurations for an agent in a project.
 * Merges definition defaults with project-specific overrides.
 */
export async function resolveTriggerConfigs(
	projectId: string,
	agentType: string,
): Promise<ResolvedTriggerConfig[]> {
	// Get definition triggers
	const definition = await resolveAgentDefinition(agentType);
	if (!definition) {
		return [];
	}

	const definitionTriggers = definition.triggers ?? [];
	if (definitionTriggers.length === 0) {
		return [];
	}

	// Get project overrides
	const dbConfigs = await getTriggerConfigsByProjectAndAgent(projectId, agentType);
	const dbConfigMap = new Map<string, AgentTriggerConfig>();
	for (const config of dbConfigs) {
		dbConfigMap.set(config.triggerEvent, config);
	}

	// Merge definition defaults with overrides
	return definitionTriggers.map((trigger) => {
		const override = dbConfigMap.get(trigger.event);
		return mergeTriggerConfig(trigger, override);
	});
}

/**
 * Check if a specific trigger is enabled for a project/agent combination.
 * This is the primary function for trigger handlers to use.
 */
export async function isTriggerEnabled(
	projectId: string,
	agentType: string,
	triggerEvent: string,
): Promise<boolean> {
	// First check DB override
	const dbConfig = await getTriggerConfig(projectId, agentType, triggerEvent);
	if (dbConfig) {
		return dbConfig.enabled;
	}

	// Fall back to definition default
	const definition = await resolveAgentDefinition(agentType);
	if (!definition) {
		return false;
	}

	const trigger = definition.triggers?.find((t) => t.event === triggerEvent);
	if (!trigger) {
		return false;
	}

	return trigger.defaultEnabled;
}

/**
 * Get trigger parameters for a specific trigger.
 * Returns merged parameters (definition defaults + project overrides).
 */
export async function getTriggerParameters(
	projectId: string,
	agentType: string,
	triggerEvent: string,
): Promise<Record<string, unknown>> {
	const definition = await resolveAgentDefinition(agentType);
	if (!definition) {
		return {};
	}

	const trigger = definition.triggers?.find((t) => t.event === triggerEvent);
	if (!trigger) {
		return {};
	}

	// Build default parameters from definition
	const defaultParams: Record<string, unknown> = {};
	for (const param of trigger.parameters ?? []) {
		if (param.defaultValue !== undefined) {
			defaultParams[param.name] = param.defaultValue;
		}
	}

	// Get DB override
	const dbConfig = await getTriggerConfig(projectId, agentType, triggerEvent);
	if (!dbConfig) {
		return defaultParams;
	}

	// Merge: DB overrides take precedence
	return { ...defaultParams, ...dbConfig.parameters };
}

/**
 * Get a single resolved trigger configuration.
 */
export async function getResolvedTriggerConfig(
	projectId: string,
	agentType: string,
	triggerEvent: string,
): Promise<ResolvedTriggerConfig | null> {
	const definition = await resolveAgentDefinition(agentType);
	if (!definition) {
		return null;
	}

	const trigger = definition.triggers?.find((t) => t.event === triggerEvent);
	if (!trigger) {
		return null;
	}

	const dbConfig = await getTriggerConfig(projectId, agentType, triggerEvent);
	return mergeTriggerConfig(trigger, dbConfig ?? undefined);
}

// ============================================================================
// Helpers
// ============================================================================

function mergeTriggerConfig(
	trigger: SupportedTrigger,
	override?: AgentTriggerConfig,
): ResolvedTriggerConfig {
	// Build default parameters from definition
	const defaultParams: Record<string, unknown> = {};
	for (const param of trigger.parameters ?? []) {
		if (param.defaultValue !== undefined) {
			defaultParams[param.name] = param.defaultValue;
		}
	}

	// Merge parameters
	const mergedParams = override ? { ...defaultParams, ...override.parameters } : defaultParams;

	return {
		event: trigger.event,
		label: trigger.label,
		description: trigger.description,
		enabled: override ? override.enabled : trigger.defaultEnabled,
		parameters: mergedParams,
		providers: trigger.providers,
		isCustomized: !!override,
	};
}

// ============================================================================
// Legacy Fallback Support
// ============================================================================

/**
 * Check if a trigger is enabled using the legacy project_integrations.triggers config.
 * This is a fallback for projects that haven't migrated to the new system.
 *
 * @param legacyTriggers - The triggers JSONB from project_integrations
 * @param triggerEvent - The new-style event name (e.g., 'pm:card-moved')
 * @param legacyKey - The legacy trigger config key (e.g., 'cardMovedToTodo')
 * @param defaultValue - Default value if not found
 */
export function resolveLegacyTriggerEnabled(
	legacyTriggers: Record<string, unknown> | null | undefined,
	_triggerEvent: string,
	legacyKey: string,
	defaultValue: boolean,
): boolean {
	if (!legacyTriggers) {
		return defaultValue;
	}

	const value = legacyTriggers[legacyKey];
	if (typeof value === 'boolean') {
		return value;
	}

	return defaultValue;
}

/**
 * Map from new trigger event names to legacy trigger config keys.
 * Used for backward compatibility during migration.
 */
export const LEGACY_TRIGGER_KEY_MAP: Record<string, string> = {
	// PM triggers
	'pm:card-moved': 'cardMovedToTodo', // varies by agent
	'pm:issue-transitioned': 'issueTransitioned',
	'pm:label-added': 'readyToProcessLabel',
	'pm:comment-mention': 'commentMention',
	// SCM triggers
	'scm:check-suite-success': 'checkSuiteSuccess',
	'scm:check-suite-failure': 'checkSuiteFailure',
	'scm:pr-review-submitted': 'prReviewSubmitted',
	'scm:pr-comment-mention': 'prCommentMention',
	'scm:review-requested': 'reviewRequested',
	'scm:pr-opened': 'prOpened',
	// Email triggers
	'email:received': 'emailReceived',
};

/**
 * Get the legacy trigger key for an agent-specific card-moved trigger.
 */
export function getLegacyCardMovedKey(agentType: string): string {
	switch (agentType) {
		case 'splitting':
			return 'cardMovedToSplitting';
		case 'planning':
			return 'cardMovedToPlanning';
		case 'implementation':
			return 'cardMovedToTodo';
		default:
			return 'cardMovedToTodo';
	}
}
