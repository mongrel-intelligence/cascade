import {
	ClaudeCodeBackend,
	LlmistBackend,
	executeWithBackend,
	getBackend,
	getRegisteredBackends,
	registerBackend,
	resolveBackendName,
} from '../backends/index.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';

// Register backends on module load
registerBackend(new LlmistBackend());
registerBackend(new ClaudeCodeBackend());

/**
 * Run an agent using the appropriate backend.
 *
 * Backend resolution order:
 * 1. Project-level agent type override
 * 2. Project-level default backend
 * 3. Cascade-level default backend
 * 4. Fallback: 'llmist'
 *
 * All backends — including llmist — go through the shared adapter
 * (executeWithBackend), which handles repo setup, lifecycle, progress
 * monitoring, run tracking, and log finalization in one place.
 */
export async function runAgent(
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
): Promise<AgentResult> {
	const backendName = resolveBackendName(agentType, input.project, input.config);
	const backend = getBackend(backendName);

	if (!backend) {
		return {
			success: false,
			output: '',
			error: `Unknown agent backend: "${backendName}". Registered backends: ${getRegisteredBackends().join(', ')}`,
		};
	}

	if (!backend.supportsAgentType(agentType)) {
		return {
			success: false,
			output: '',
			error: `Backend "${backendName}" does not support agent type "${agentType}"`,
		};
	}

	logger.info('Running agent via backend', { agentType, backend: backendName });

	// All backends (including llmist) use the shared adapter which handles:
	// - Repo setup, CWD change/restore, env var loading
	// - Run record creation, log finalization
	// - Progress monitor, watchdog
	return executeWithBackend(backend, agentType, input);
}

export { registerBackend } from '../backends/index.js';
