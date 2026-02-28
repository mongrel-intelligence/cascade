import { resolveAgentDefinition } from '../definitions/loader.js';

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
	/** Can the agent send/search/read emails? (default: false) */
	canAccessEmail?: boolean;
}

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
 * Look up capabilities for a given agent type.
 * Reads from the async resolver (cache → DB → YAML); falls back to full-access defaults for unknown types.
 */
export async function getAgentCapabilities(agentType: string): Promise<AgentCapabilities> {
	try {
		const def = await resolveAgentDefinition(agentType);
		return def.capabilities;
	} catch {
		return DEFAULT_CAPABILITIES;
	}
}
