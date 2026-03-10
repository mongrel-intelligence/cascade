/**
 * Shared types for the trigger configuration API.
 * These types are used by both the backend (tRPC router) and frontend (dashboard).
 */

import {
	CONTEXT_STEP_NAMES,
	type ContextStepName,
	type KnownProvider,
} from '../../../agents/definitions/schema.js';

// Re-export for convenience
export type { ContextStepName, KnownProvider };
export { CONTEXT_STEP_NAMES };

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
	/** Event identifier (e.g., "pm:status-changed", "scm:check-suite-success") */
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
	internal: 'Internal',
} as const;

/**
 * Valid trigger categories.
 */
export type TriggerCategory = 'pm' | 'scm' | 'email' | 'internal';

// ============================================================================
// Known Trigger Registry
// ============================================================================

/**
 * A known trigger event definition with metadata.
 * Used for populating the definition editor's trigger selection UI.
 */
export interface KnownTriggerEvent {
	/** Event identifier (e.g., "pm:status-changed", "scm:check-suite-success") */
	event: string;
	/** Human-readable label */
	label: string;
	/** Description of when this trigger fires */
	description: string;
	/** Context pipeline elements this trigger typically brings */
	contextPipeline: ContextStepName[];
	/** Provider restrictions (if provider-specific) */
	providers?: KnownProvider[];
}

/**
 * Registry of all known trigger events organized by category.
 * Used by the definition editor to show available triggers.
 */
export const TRIGGER_REGISTRY: Record<TriggerCategory, KnownTriggerEvent[]> = {
	pm: [
		{
			event: 'pm:status-changed',
			label: 'Status Changed',
			description: 'Work item moved to a new status/list',
			contextPipeline: ['workItem'],
		},
		{
			event: 'pm:label-added',
			label: 'Label Added',
			description: 'Label added to card/issue',
			contextPipeline: ['workItem'],
		},
		{
			event: 'pm:comment-mention',
			label: 'Comment Mention',
			description: 'Bot mentioned in comment',
			contextPipeline: ['workItem'],
		},
	],
	scm: [
		{
			event: 'scm:check-suite-success',
			label: 'CI Passed',
			description: 'CI check suite passed',
			contextPipeline: ['prContext'],
			providers: ['github'],
		},
		{
			event: 'scm:check-suite-failure',
			label: 'CI Failed',
			description: 'CI check suite failed',
			contextPipeline: ['prContext'],
			providers: ['github'],
		},
		{
			event: 'scm:pr-review-submitted',
			label: 'PR Review Submitted',
			description: 'Review submitted on PR',
			contextPipeline: ['prContext', 'prConversation'],
			providers: ['github'],
		},
		{
			event: 'scm:review-requested',
			label: 'Review Requested',
			description: 'Review requested on PR',
			contextPipeline: ['prContext'],
			providers: ['github'],
		},
		{
			event: 'scm:pr-opened',
			label: 'PR Opened',
			description: 'PR opened',
			contextPipeline: ['prContext'],
			providers: ['github'],
		},
		{
			event: 'scm:pr-comment',
			label: 'PR Comment',
			description: 'Comment added to PR',
			contextPipeline: ['prContext', 'prConversation'],
			providers: ['github'],
		},
		{
			event: 'scm:pr-merged',
			label: 'PR Merged',
			description: 'PR merged to base branch',
			contextPipeline: ['prContext'],
			providers: ['github'],
		},
		{
			event: 'scm:pr-ready-to-merge',
			label: 'PR Ready to Merge',
			description: 'PR approved and CI passed',
			contextPipeline: ['prContext'],
			providers: ['github'],
		},
	],
	email: [
		{
			event: 'email:received',
			label: 'Email Received',
			description: 'Email received',
			contextPipeline: [],
		},
	],
	internal: [
		{
			event: 'internal:auto-chain',
			label: 'Auto-Chain',
			description: 'Orchestration trigger for chaining agents after completion',
			contextPipeline: [],
		},
	],
};
