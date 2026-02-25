import { getKnownAgentTypes, loadAgentDefinition } from '../agents/definitions/index.js';

// ============================================================================
// Agent Labels, Role Hints, and Initial Messages — derived from YAML definitions
// ============================================================================

function buildRecords(): {
	labels: Record<string, { emoji: string; label: string }>;
	roleHints: Record<string, string>;
	initialMessages: Record<string, string>;
} {
	const labels: Record<string, { emoji: string; label: string }> = {};
	const roleHints: Record<string, string> = {};
	const initialMessages: Record<string, string> = {};

	for (const agentType of getKnownAgentTypes()) {
		const def = loadAgentDefinition(agentType);
		labels[agentType] = { emoji: def.identity.emoji, label: def.identity.label };
		roleHints[agentType] = def.identity.roleHint;
		initialMessages[agentType] = def.identity.initialMessage;
	}

	return { labels, roleHints, initialMessages };
}

// Eager-load at module init (YAML files are on disk, read is fast)
let labels: Record<string, { emoji: string; label: string }>;
let roleHints: Record<string, string>;
let initialMessages: Record<string, string>;
try {
	({ labels, roleHints, initialMessages } = buildRecords());
} catch (err) {
	throw new Error('Failed to load agent identity records from YAML definitions', { cause: err });
}

/**
 * Agent-specific emoji and label for progress update headers.
 *
 * Used by:
 * - progressModel.ts — LLM prompt to produce correct header
 * - statusUpdateConfig.ts — template fallback header
 */
export const AGENT_LABELS: Record<string, { emoji: string; label: string }> = labels;

/**
 * Get the emoji and label for a given agent type.
 * Falls back to a generic label for unknown agent types.
 */
export function getAgentLabel(agentType: string): { emoji: string; label: string } {
	return AGENT_LABELS[agentType] ?? { emoji: '⚙️', label: 'Progress Update' };
}

/**
 * Agent role hints — give LLMs context about what each agent type does.
 *
 * Used by:
 * - ackMessageGenerator.ts — contextual acknowledgment messages
 * - progressModel.ts — progress update generation
 */
export const AGENT_ROLE_HINTS: Record<string, string> = roleHints;

/**
 * Human-readable initial messages per agent type.
 *
 * Used by:
 * - ProgressMonitor (worker-side) — initial comment on work item
 * - Router acknowledgments — immediate ack before worker starts
 */
export const INITIAL_MESSAGES: Record<string, string> = initialMessages;
