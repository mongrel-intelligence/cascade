/**
 * Shared types for the trigger configuration API.
 * These types are used by both the backend (tRPC router) and frontend (dashboard).
 */

// ============================================================================
// Parameter Types
// ============================================================================

/**
 * Supported parameter value types for triggers.
 */
export type TriggerParameterValue = string | boolean | number;

/**
 * Parameter definition for a trigger.
 * Defines the schema for a configurable parameter.
 */
export interface TriggerParameterDef {
	name: string;
	type: 'string' | 'email' | 'boolean' | 'select' | 'number';
	label: string;
	description: string | null;
	required: boolean;
	defaultValue: TriggerParameterValue | null;
	options: string[] | null;
}

// ============================================================================
// Resolved Trigger Types
// ============================================================================

/**
 * A resolved trigger with merged definition and config data.
 * Returned by getProjectTriggersView for dashboard rendering.
 */
export interface ResolvedTrigger {
	/** Event identifier (e.g., "pm:card-moved", "scm:check-suite-success") */
	event: string;
	/** Human-readable label */
	label: string;
	/** Optional description */
	description: string | null;
	/** Provider restrictions (e.g., ["trello"], ["github"]) */
	providers: string[] | null;
	/** Whether this trigger is currently enabled */
	enabled: boolean;
	/** Current parameter values (merged from definition defaults + config overrides) */
	parameters: Record<string, TriggerParameterValue>;
	/** Parameter definitions for UI rendering */
	parameterDefs: TriggerParameterDef[];
	/** Whether this trigger has been customized from defaults */
	isCustomized: boolean;
}

/**
 * Agent with its resolved triggers.
 */
export interface AgentTriggersView {
	agentType: string;
	triggers: ResolvedTrigger[];
}

/**
 * Active integration providers for a project.
 */
export interface ProjectIntegrationsMap {
	pm: string | null;
	scm: string | null;
	email: string | null;
	sms: string | null;
}

/**
 * Complete triggers view for a project.
 * Response type for getProjectTriggersView.
 */
export interface ProjectTriggersView {
	agents: AgentTriggersView[];
	integrations: ProjectIntegrationsMap;
}

// ============================================================================
// Category Labels
// ============================================================================

/**
 * Human-readable labels for trigger categories.
 */
export const TRIGGER_CATEGORY_LABELS: Record<string, string> = {
	pm: 'Project Management',
	scm: 'Source Control',
	email: 'Email',
	sms: 'SMS',
} as const;

/**
 * Valid trigger categories.
 */
export type TriggerCategory = 'pm' | 'scm' | 'email' | 'sms';
