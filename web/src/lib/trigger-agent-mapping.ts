/**
 * Defines the mapping between agent types and their trigger toggles.
 * Used to render trigger configuration in the Agent Configs tab.
 */

export interface TriggerDef {
	/** Dot-notation path into the triggers config, e.g. "cardMovedToBriefing" or "readyToProcessLabel.briefing" */
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
		defaultValue: true,
		scmProvider: 'github',
		category: 'scm',
	},
	{
		key: 'prMerged',
		label: 'PR Merged',
		description: 'Auto-move card to MERGED when PR is merged.',
		defaultValue: true,
		scmProvider: 'github',
		category: 'scm',
	},
];

/**
 * Shared PM triggers that affect multiple agent types.
 * Displayed once in a dedicated section rather than duplicated per-agent.
 */
export const SHARED_PM_TRIGGERS: TriggerDef[] = [
	{
		key: 'issueTransitioned',
		label: 'Issue Transitioned',
		description:
			'Trigger agent when a JIRA issue transitions to a configured status. Affects briefing, planning, and implementation agents.',
		defaultValue: true,
		pmProvider: 'jira',
		category: 'pm',
	},
	{
		key: 'commentMention',
		label: 'Comment @mention',
		description:
			'Trigger agent when the bot is @mentioned in a card/issue comment. Affects planning and respond-to-planning-comment agents.',
		defaultValue: true,
		category: 'pm',
	},
];

/**
 * Map from agent type to the trigger toggles relevant to it.
 */
export const AGENT_TRIGGER_MAP: Record<string, TriggerDef[]> = {
	briefing: [
		{
			key: 'cardMovedToBriefing',
			label: 'Card moved to Briefing',
			description: 'Trigger briefing agent when a card is moved to the Briefing list.',
			defaultValue: true,
			pmProvider: 'trello',
			category: 'pm',
		},
		{
			key: 'readyToProcessLabel.briefing',
			label: 'Ready to Process label',
			description:
				'Trigger briefing agent when the "Ready to Process" label is added to a card in the Briefing list.',
			defaultValue: true,
			category: 'pm',
		},
	],
	planning: [
		{
			key: 'cardMovedToPlanning',
			label: 'Card moved to Planning',
			description: 'Trigger planning agent when a card is moved to the Planning list.',
			defaultValue: true,
			pmProvider: 'trello',
			category: 'pm',
		},
		{
			key: 'readyToProcessLabel.planning',
			label: 'Ready to Process label',
			description:
				'Trigger planning agent when the "Ready to Process" label is added to a card in the Planning list.',
			defaultValue: true,
			category: 'pm',
		},
	],
	implementation: [
		{
			key: 'cardMovedToTodo',
			label: 'Card moved to Todo',
			description: 'Trigger implementation agent when a card is moved to the Todo list.',
			defaultValue: true,
			pmProvider: 'trello',
			category: 'pm',
		},
		{
			key: 'readyToProcessLabel.implementation',
			label: 'Ready to Process label',
			description:
				'Trigger implementation agent when the "Ready to Process" label is added to a card in the Todo list.',
			defaultValue: true,
			category: 'pm',
		},
	],
	review: [
		{
			key: 'reviewTrigger.ownPrsOnly',
			label: 'Own PRs Only',
			description:
				'Trigger review agent when CI passes on PRs authored by the implementer persona.',
			defaultValue: false,
			scmProvider: 'github',
			category: 'scm',
		},
		{
			key: 'reviewTrigger.externalPrs',
			label: 'External PRs',
			description:
				'Trigger review agent when CI passes on PRs authored by anyone (not just the implementer).',
			defaultValue: false,
			scmProvider: 'github',
			category: 'scm',
		},
		{
			key: 'reviewTrigger.onReviewRequested',
			label: 'On Review Requested',
			description:
				'Trigger review agent when a CASCADE persona is explicitly requested as reviewer.',
			defaultValue: false,
			scmProvider: 'github',
			category: 'scm',
		},
	],
	'respond-to-review': [
		{
			key: 'prReviewSubmitted',
			label: 'PR Review Submitted',
			description: 'Trigger respond-to-review when a review with changes requested is submitted.',
			defaultValue: true,
			scmProvider: 'github',
			category: 'scm',
		},
		{
			key: 'prOpened',
			label: 'PR Opened (opt-in)',
			description: 'Trigger respond-to-review when a new PR is opened. Default disabled.',
			defaultValue: false,
			scmProvider: 'github',
			category: 'scm',
		},
	],
	'respond-to-ci': [
		{
			key: 'checkSuiteFailure',
			label: 'Check Suite Failure',
			description: 'Trigger respond-to-ci agent when CI checks fail.',
			defaultValue: true,
			scmProvider: 'github',
			category: 'scm',
		},
	],
	'respond-to-pr-comment': [
		{
			key: 'prCommentMention',
			label: 'PR Comment @mention',
			description:
				'Trigger respond-to-pr-comment when the implementer bot is @mentioned in a PR comment.',
			defaultValue: true,
			scmProvider: 'github',
			category: 'scm',
		},
	],
	'respond-to-planning-comment': [],
};

/**
 * Get trigger definitions for a specific agent type, filtered by PM provider.
 */
export function getTriggersForAgent(agentType: string, pmProvider?: string): TriggerDef[] {
	const triggers = AGENT_TRIGGER_MAP[agentType] ?? [];
	return triggers.filter((t) => {
		if (t.pmProvider && pmProvider && t.pmProvider !== pmProvider) return false;
		return true;
	});
}

/**
 * Get the trigger value from a flat triggers record using dot-notation path.
 * e.g. "readyToProcessLabel.briefing" reads triggers.readyToProcessLabel.briefing
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
	// Nested path (e.g., readyToProcessLabel.briefing)
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
	// Nested path (e.g., readyToProcessLabel.briefing)
	const [parent, child] = parts;
	const parentVal = triggers[parent];
	let parentObj: Record<string, unknown> = {};
	if (typeof parentVal === 'boolean') {
		// Expand legacy boolean into object — apply the boolean value to all agents
		parentObj = {
			briefing: parentVal,
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
	'briefing',
	'planning',
	'implementation',
	'review',
	'respond-to-review',
	'respond-to-ci',
	'respond-to-pr-comment',
	'respond-to-planning-comment',
] as const;

export type KnownAgentType = (typeof ALL_AGENT_TYPES)[number];
