/**
 * Trigger Configuration Resolver
 *
 * This module resolves trigger configurations by merging multiple sources:
 *
 * 1. **Definition defaults** - From YAML agent definitions (e.g., `implementation.yaml`)
 *    - Each agent declares supported triggers in `triggers[]`
 *    - Each trigger has `defaultEnabled` and default `parameters`
 *
 * 2. **Project-level overrides** - From `agent_trigger_configs` table
 *    - Per-project, per-agent, per-trigger customization
 *    - Can override `enabled` and `parameters`
 *
 * 3. **Legacy fallback** - From `project_integrations.triggers` JSONB
 *    - For backward compatibility during migration
 *    - Uses `LEGACY_TRIGGER_KEY_MAP` for key translation
 *
 * ## Resolution Order
 *
 * 1. If config exists in `agent_trigger_configs` → use it
 * 2. Else → use definition default
 *
 * ## Usage
 *
 * Trigger handlers should use:
 * - `isTriggerEnabled(projectId, agentType, event)` - Check if trigger should fire
 * - `getTriggerParameters(projectId, agentType, event)` - Get merged parameters
 *
 * Dashboard should use:
 * - `resolveTriggerConfigs(projectId, agentType)` - Get all triggers with their configs
 *
 * ## Note on contextPipeline
 *
 * The `contextPipeline` field in trigger definitions is read-only from YAML.
 * It cannot be overridden per-project via the database. If different triggers
 * need different context, declare `contextPipeline` per-trigger in the YAML.
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
	/** Trigger event identifier (e.g., 'pm:status-changed') */
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
