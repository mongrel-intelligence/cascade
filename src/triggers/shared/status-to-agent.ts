/**
 * Shared status-to-agent mapping used across PM trigger handlers (JIRA, Linear, etc.).
 *
 * Maps CASCADE status keys to agent types.
 *
 * Project config maps CASCADE status names to platform-specific status/state
 * names, e.g.: { splitting: "Splitting", planning: "Planning", todo: "To Do" }
 *
 * We invert that mapping at runtime: if the issue transitioned to "Splitting",
 * we look up `splitting` → `splitting` agent.
 */
export const STATUS_TO_AGENT: Record<string, string> = {
	splitting: 'splitting',
	planning: 'planning',
	todo: 'implementation',
	backlog: 'backlog-manager',
};
