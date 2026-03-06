import { resolveAllAgentDefinitions, resolveKnownAgentTypes } from '../agents/definitions/index.js';

// ============================================================================
// Agent Labels, Role Hints, and Initial Messages — derived from agent definitions
// ============================================================================

let initialized = false;
const _labels: Record<string, { emoji: string; label: string }> = {};
const _roleHints: Record<string, string> = {};
const _initialMessages: Record<string, string> = {};

function requireInitialized(name: string): void {
	if (!initialized) {
		throw new Error(
			`agentMessages: '${name}' was accessed before initAgentMessages() completed. Call initAgentMessages() at startup before using AGENT_LABELS, AGENT_ROLE_HINTS, or INITIAL_MESSAGES.`,
		);
	}
}

/**
 * Initialize agent message records from the database (with YAML fallback).
 *
 * Must be called at startup (after DB is ready) before any code accesses
 * AGENT_LABELS, AGENT_ROLE_HINTS, or INITIAL_MESSAGES.
 */
export async function initAgentMessages(): Promise<void> {
	const [allDefs, knownTypes] = await Promise.all([
		resolveAllAgentDefinitions(),
		resolveKnownAgentTypes(),
	]);

	for (const agentType of knownTypes) {
		const def = allDefs.get(agentType);
		if (!def) continue;
		_labels[agentType] = { emoji: def.identity.emoji, label: def.identity.label };
		_roleHints[agentType] = def.identity.roleHint;
		_initialMessages[agentType] = def.identity.initialMessage;
	}

	initialized = true;
}

/**
 * Reset agent messages state (for testing only).
 * @internal
 */
export function _resetAgentMessages(): void {
	initialized = false;
	for (const key of Object.keys(_labels)) delete _labels[key];
	for (const key of Object.keys(_roleHints)) delete _roleHints[key];
	for (const key of Object.keys(_initialMessages)) delete _initialMessages[key];
}

/**
 * Agent-specific emoji and label for progress update headers.
 *
 * Used by:
 * - progressModel.ts — LLM prompt to produce correct header
 * - statusUpdateConfig.ts — template fallback header
 *
 * Throws if accessed before initAgentMessages() completes.
 */
export const AGENT_LABELS: Record<string, { emoji: string; label: string }> = new Proxy(_labels, {
	get(target, prop, receiver) {
		if (typeof prop === 'string' && prop !== '__esModule') {
			requireInitialized('AGENT_LABELS');
		}
		return Reflect.get(target, prop, receiver);
	},
});

/**
 * Get the emoji and label for a given agent type.
 * Falls back to a generic label for unknown agent types.
 *
 * Throws if called before initAgentMessages() completes.
 */
export function getAgentLabel(agentType: string): { emoji: string; label: string } {
	requireInitialized('getAgentLabel');
	return _labels[agentType] ?? { emoji: '⚙️', label: 'Progress Update' };
}

/**
 * Agent role hints — give LLMs context about what each agent type does.
 *
 * Used by:
 * - ackMessageGenerator.ts — contextual acknowledgment messages
 * - progressModel.ts — progress update generation
 *
 * Throws if accessed before initAgentMessages() completes.
 */
export const AGENT_ROLE_HINTS: Record<string, string> = new Proxy(_roleHints, {
	get(target, prop, receiver) {
		if (typeof prop === 'string' && prop !== '__esModule') {
			requireInitialized('AGENT_ROLE_HINTS');
		}
		return Reflect.get(target, prop, receiver);
	},
});

/**
 * Human-readable initial messages per agent type.
 *
 * Used by:
 * - ProgressMonitor (worker-side) — initial comment on work item
 * - Router acknowledgments — immediate ack before worker starts
 *
 * Throws if accessed before initAgentMessages() completes.
 */
export const INITIAL_MESSAGES: Record<string, string> = new Proxy(_initialMessages, {
	get(target, prop, receiver) {
		if (typeof prop === 'string' && prop !== '__esModule') {
			requireInitialized('INITIAL_MESSAGES');
		}
		return Reflect.get(target, prop, receiver);
	},
});
