import type { CascadeConfig, ProjectConfig } from '../types/index.js';

/**
 * Resolve which backend name to use for a given agent type.
 *
 * Resolution order (most specific wins):
 * 1. Project-level agent type override: project.agentBackend.overrides[agentType]
 * 2. Project-level default: project.agentBackend.default
 * 3. Cascade-level default: config.defaults.agentBackend
 * 4. Hardcoded fallback: 'llmist'
 */
export function resolveBackendName(
	agentType: string,
	project: ProjectConfig,
	config: CascadeConfig,
): string {
	return (
		project.agentBackend?.overrides?.[agentType] ??
		project.agentBackend?.default ??
		config.defaults.agentBackend ??
		'llmist'
	);
}
