import type { ProjectConfig } from '../types/index.js';

export const DEFAULT_ENGINE = 'claude-code';

/**
 * Resolve which engine name to use for a given agent type.
 *
 * Resolution order (most specific wins):
 * 1. Project-level agent type override: project.agentEngine.overrides[agentType]
 * 2. Project-level default: project.agentEngine.default
 * 3. Hardcoded fallback: DEFAULT_ENGINE ('claude-code')
 */
export function resolveEngineName(agentType: string, project: ProjectConfig): string {
	return (
		project.agentEngine?.overrides?.[agentType] ?? project.agentEngine?.default ?? DEFAULT_ENGINE
	);
}
