/**
 * Mapping of integration config keys to agent types.
 * Defines which triggers fire which agents, and what config fields are relevant.
 */

export type TriggerSource = 'trello' | 'jira' | 'github';

export interface TriggerAgentMapping {
	/** The agent type that handles this trigger */
	agentType: string;
	/** Human-readable name for the trigger */
	triggerName: string;
	/** The integration config key (e.g., "briefing" in trello.lists) */
	configKey: string;
	/** Which integration source this trigger comes from */
	source: TriggerSource;
	/** Description shown in the UI */
	description: string;
	/** Whether this trigger is configurable (false = read-only description) */
	configurable: boolean;
	/** Type of config field */
	fieldType?: 'trello-list' | 'jira-status';
	/** Label shown for the config field */
	fieldLabel?: string;
}

/**
 * All trigger-to-agent mappings.
 * Used to display trigger config inline with agent configs.
 */
export const TRIGGER_AGENT_MAPPINGS: TriggerAgentMapping[] = [
	// Trello triggers
	{
		agentType: 'briefing',
		triggerName: 'Card Moved to Briefing List',
		configKey: 'briefing',
		source: 'trello',
		description: 'Fires when a card is moved to the Briefing list',
		configurable: true,
		fieldType: 'trello-list',
		fieldLabel: 'Briefing List ID',
	},
	{
		agentType: 'planning',
		triggerName: 'Card Moved to Planning List',
		configKey: 'planning',
		source: 'trello',
		description: 'Fires when a card is moved to the Planning list',
		configurable: true,
		fieldType: 'trello-list',
		fieldLabel: 'Planning List ID',
	},
	{
		agentType: 'implementation',
		triggerName: 'Card Moved to TODO List',
		configKey: 'todo',
		source: 'trello',
		description: 'Fires when a card is moved to the TODO list',
		configurable: true,
		fieldType: 'trello-list',
		fieldLabel: 'TODO List ID',
	},

	// JIRA triggers
	{
		agentType: 'briefing',
		triggerName: 'Issue Transitioned to Briefing Status',
		configKey: 'briefing',
		source: 'jira',
		description: 'Fires when a JIRA issue transitions to the briefing status',
		configurable: true,
		fieldType: 'jira-status',
		fieldLabel: 'Briefing Status',
	},
	{
		agentType: 'planning',
		triggerName: 'Issue Transitioned to Planning Status',
		configKey: 'planning',
		source: 'jira',
		description: 'Fires when a JIRA issue transitions to the planning status',
		configurable: true,
		fieldType: 'jira-status',
		fieldLabel: 'Planning Status',
	},
	{
		agentType: 'implementation',
		triggerName: 'Issue Transitioned to TODO Status',
		configKey: 'todo',
		source: 'jira',
		description: 'Fires when a JIRA issue transitions to the todo status',
		configurable: true,
		fieldType: 'jira-status',
		fieldLabel: 'TODO Status',
	},
	{
		agentType: 'implementation',
		triggerName: 'Issue Transitioned to In Progress Status',
		configKey: 'inProgress',
		source: 'jira',
		description: 'Fires when a JIRA issue transitions to the in-progress status',
		configurable: true,
		fieldType: 'jira-status',
		fieldLabel: 'In Progress Status',
	},

	// GitHub triggers (not configurable — automatic)
	{
		agentType: 'review',
		triggerName: 'Check Suite Success',
		configKey: 'check-suite-success',
		source: 'github',
		description: 'Automatically fires when CI checks pass on a PR',
		configurable: false,
	},
	{
		agentType: 'respond-to-ci',
		triggerName: 'Check Suite Failure',
		configKey: 'check-suite-failure',
		source: 'github',
		description: 'Automatically fires when CI checks fail on a PR',
		configurable: false,
	},
	{
		agentType: 'respond-to-review',
		triggerName: 'PR Review Submitted',
		configKey: 'pr-review-submitted',
		source: 'github',
		description: 'Automatically fires when the reviewer bot requests changes',
		configurable: false,
	},
	{
		agentType: 'respond-to-pr-comment',
		triggerName: 'PR Comment @mention',
		configKey: 'pr-comment-mention',
		source: 'github',
		description: 'Automatically fires when the implementer bot is @mentioned in a PR comment',
		configurable: false,
	},
	{
		agentType: 'respond-to-planning-comment',
		triggerName: 'Trello Comment @mention',
		configKey: 'comment-mention',
		source: 'trello',
		description: 'Automatically fires when the bot is @mentioned in a Trello card comment',
		configurable: false,
	},
	{
		agentType: 'respond-to-planning-comment',
		triggerName: 'JIRA Comment @mention',
		configKey: 'comment-mention',
		source: 'jira',
		description: 'Automatically fires when the bot is @mentioned in a JIRA comment',
		configurable: false,
	},
];

/**
 * Known CASCADE agent types.
 */
export const KNOWN_AGENT_TYPES = [
	'briefing',
	'planning',
	'implementation',
	'review',
	'respond-to-ci',
	'respond-to-review',
	'respond-to-pr-comment',
	'respond-to-planning-comment',
	'debug',
] as const;

export type KnownAgentType = (typeof KNOWN_AGENT_TYPES)[number];

/**
 * Get all trigger mappings for a specific agent type.
 */
export function getMappingsForAgent(agentType: string): TriggerAgentMapping[] {
	return TRIGGER_AGENT_MAPPINGS.filter((m) => m.agentType === agentType);
}

/**
 * Get all trigger names for an agent (for display in tables).
 */
export function getTriggerNamesForAgent(agentType: string): string[] {
	return getMappingsForAgent(agentType).map((m) => m.triggerName);
}
