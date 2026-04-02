/**
 * Trigger mapping utilities for the Agent Configs tab.
 * Uses definition-based triggers from the API via agentTriggerConfigs.getProjectTriggersView.
 */

export type {
	ProjectTriggersView,
	ResolvedTrigger,
	TriggerParameterDef,
	TriggerParameterValue,
} from '../../../src/api/routers/_shared/triggerTypes.js';
// Re-export shared types for convenience
export { TRIGGER_CATEGORY_LABELS as CATEGORY_LABELS } from '../../../src/api/routers/_shared/triggerTypes.js';

// ============================================================================
// Types
// ============================================================================

export interface TriggerDef {
	/** Dot-notation path into the triggers config, e.g. "cardMovedToSplitting" or "readyToProcessLabel.splitting" */
	key: string;
	label: string;
	description: string;
	defaultValue: boolean;
	/** PM provider this trigger applies to (if omitted, shown for all providers) */
	pmProvider?: 'trello' | 'jira';
	/** SCM provider this trigger applies to */
	scmProvider?: 'github';
	/** Integration category this trigger belongs to */
	category: 'pm' | 'scm';
}

/**
 * Lifecycle triggers that don't belong to a specific agent.
 */
export const LIFECYCLE_TRIGGERS: TriggerDef[] = [
	{
		key: 'prReadyToMerge',
		label: 'PR Ready to Merge',
		description: 'Auto-move card to DONE when PR is approved and checks pass.',
		defaultValue: false,
		scmProvider: 'github',
		category: 'scm',
	},
	{
		key: 'prMerged',
		label: 'PR Merged',
		description: 'Auto-move card to MERGED when PR is merged.',
		defaultValue: false,
		scmProvider: 'github',
		category: 'scm',
	},
];

/**
 * Get the trigger value from a flat triggers record using dot-notation path.
 * e.g. "readyToProcessLabel.splitting" reads triggers.readyToProcessLabel.splitting
 */
export function getTriggerValue(
	triggers: Record<string, unknown>,
	key: string,
	defaultValue: boolean,
): boolean {
	const parts = key.split('.');
	if (parts.length === 1) {
		const val = triggers[key];
		if (typeof val === 'boolean') return val;
		return defaultValue;
	}
	// Nested path (e.g., readyToProcessLabel.splitting)
	const [parent, child] = parts;
	const parentVal = triggers[parent];
	if (typeof parentVal === 'boolean') {
		// Legacy boolean — applies to all children
		return parentVal;
	}
	if (typeof parentVal === 'object' && parentVal !== null) {
		const childVal = (parentVal as Record<string, unknown>)[child];
		if (typeof childVal === 'boolean') return childVal;
	}
	return defaultValue;
}

/**
 * Set a trigger value using dot-notation path, returning a new triggers record.
 */
export function setTriggerValue(
	triggers: Record<string, unknown>,
	key: string,
	value: boolean,
): Record<string, unknown> {
	const parts = key.split('.');
	if (parts.length === 1) {
		return { ...triggers, [key]: value };
	}
	// Nested path (e.g., readyToProcessLabel.splitting)
	const [parent, child] = parts;
	const parentVal = triggers[parent];
	let parentObj: Record<string, unknown> = {};
	if (typeof parentVal === 'boolean') {
		// Expand legacy boolean into object — apply the boolean value to all agents
		parentObj = {
			splitting: parentVal,
			planning: parentVal,
			implementation: parentVal,
		};
	} else if (typeof parentVal === 'object' && parentVal !== null) {
		parentObj = { ...(parentVal as Record<string, unknown>) };
	}
	return {
		...triggers,
		[parent]: { ...parentObj, [child]: value },
	};
}

/**
 * All known agent types in display order.
 */
export const ALL_AGENT_TYPES = [
	'splitting',
	'planning',
	'implementation',
	'review',
	'respond-to-review',
	'respond-to-ci',
	'resolve-conflicts',
	'respond-to-pr-comment',
	'respond-to-planning-comment',
] as const;

export type KnownAgentType = (typeof ALL_AGENT_TYPES)[number];

/** Friendly display labels for all known agent types */
export const AGENT_LABELS: Record<KnownAgentType, string> = {
	splitting: 'Splitting',
	planning: 'Planning',
	implementation: 'Implementation',
	review: 'Review',
	'respond-to-review': 'Respond to Review',
	'respond-to-ci': 'Respond to CI',
	'resolve-conflicts': 'Resolve Conflicts',
	'respond-to-pr-comment': 'Respond to PR Comment',
	'respond-to-planning-comment': 'Respond to Planning Comment',
};
