// ============================================================================
// AgentCapabilities
// ============================================================================

/**
 * Describes what a particular agent type is allowed to do.
 *
 * Consumed by the llmist backend (agents/base.ts) to gate gadget inclusion
 * and by the Claude Code backend (backends/agent-profiles.ts) for tool filtering.
 *
 * Keeping this in agents/shared/ avoids circular imports between agents/ and backends/.
 */
export interface AgentCapabilities {
	/** Can the agent read and write files? (false = read-only) */
	canEditFiles: boolean;
	/** Can the agent create GitHub pull requests? */
	canCreatePR: boolean;
	/** Can the agent update PM checklist items? */
	canUpdateChecklists: boolean;
	/** True for agents that only interact with the PM system (no repo changes) */
	isReadOnly: boolean;
}

// ============================================================================
// Capabilities Registry
// ============================================================================

/**
 * Default capabilities for unknown agent types — full access.
 */
const DEFAULT_CAPABILITIES: AgentCapabilities = {
	canEditFiles: true,
	canCreatePR: true,
	canUpdateChecklists: true,
	isReadOnly: false,
};

/**
 * Capabilities per agent type. Must stay in sync with the AgentProfile
 * definitions in backends/agent-profiles.ts.
 */
const CAPABILITIES_REGISTRY: Record<string, AgentCapabilities> = {
	briefing: {
		canEditFiles: true,
		canCreatePR: false,
		canUpdateChecklists: true,
		isReadOnly: false,
	},
	planning: {
		canEditFiles: false,
		canCreatePR: false,
		canUpdateChecklists: false,
		isReadOnly: true,
	},
	implementation: {
		canEditFiles: true,
		canCreatePR: true,
		canUpdateChecklists: true,
		isReadOnly: false,
	},
	review: {
		canEditFiles: false,
		canCreatePR: false,
		canUpdateChecklists: false,
		isReadOnly: true,
	},
	'respond-to-planning-comment': {
		canEditFiles: false,
		canCreatePR: false,
		canUpdateChecklists: true,
		isReadOnly: true,
	},
	'respond-to-review': {
		canEditFiles: false,
		canCreatePR: false,
		canUpdateChecklists: false,
		isReadOnly: true,
	},
	'respond-to-ci': {
		canEditFiles: true,
		canCreatePR: false,
		canUpdateChecklists: true,
		isReadOnly: false,
	},
	'respond-to-pr-comment': {
		canEditFiles: true,
		canCreatePR: false,
		canUpdateChecklists: false,
		isReadOnly: false,
	},
	debug: {
		canEditFiles: true,
		canCreatePR: true,
		canUpdateChecklists: true,
		isReadOnly: false,
	},
};

/**
 * Look up capabilities for a given agent type.
 * Falls back to full-access defaults for unknown types.
 */
export function getAgentCapabilities(agentType: string): AgentCapabilities {
	return CAPABILITIES_REGISTRY[agentType] ?? DEFAULT_CAPABILITIES;
}
