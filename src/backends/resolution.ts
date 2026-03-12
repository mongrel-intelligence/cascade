import type { CascadeConfig, ProjectConfig } from '../types/index.js';

/**
 * Resolve which engine name to use for a given agent type.
 *
 * Resolution order (most specific wins):
 * 1. Project-level agent type override: project.agentEngine.overrides[agentType]
 * 2. Project-level default: project.agentEngine.default
 * 3. Cascade-level default: config.defaults.agentEngine
 * 4. Hardcoded fallback: 'llmist'
 */
export function resolveEngineName(
	agentType: string,
	project: ProjectConfig,
	config: CascadeConfig,
): string {
	return (
		project.agentEngine?.overrides?.[agentType] ??
		project.agentEngine?.default ??
		config.defaults.agentEngine ??
		'llmist'
	);
}
