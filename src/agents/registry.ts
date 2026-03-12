import { executeWithEngine } from '../backends/adapter.js';
import { registerBuiltInEngines } from '../backends/bootstrap.js';
import { getEngine, getRegisteredEngines } from '../backends/registry.js';
import { resolveEngineName } from '../backends/resolution.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';

/**
 * Run an agent using the appropriate engine.
 *
 * Engine resolution order:
 * 1. Project-level agent type override
 * 2. Project-level default engine
 * 3. Cascade-level default engine
 * 4. Fallback: 'llmist'
 *
 * All engines — including llmist — go through the shared adapter
 * (executeWithEngine), which handles repo setup, lifecycle, progress
 * monitoring, run tracking, and log finalization in one place.
 */
export async function runAgent(
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
): Promise<AgentResult> {
	registerBuiltInEngines();

	const engineName = resolveEngineName(agentType, input.project, input.config);
	const engine = getEngine(engineName);

	if (!engine) {
		return {
			success: false,
			output: '',
			error: `Unknown agent engine: "${engineName}". Registered engines: ${getRegisteredEngines().join(', ')}`,
		};
	}

	if (!engine.supportsAgentType(agentType)) {
		return {
			success: false,
			output: '',
			error: `Engine "${engineName}" does not support agent type "${agentType}"`,
		};
	}

	logger.info('Running agent via engine', { agentType, engine: engineName });

	// All engines (including llmist) use the shared adapter which handles:
	// - Repo setup, CWD change/restore, env var loading
	// - Run record creation, log finalization
	// - Progress monitor, watchdog
	return executeWithEngine(engine, agentType, input);
}

export { registerEngine } from '../backends/registry.js';
