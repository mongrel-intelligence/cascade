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

	// For the llmist backend, delegate directly (it wraps existing executors)
	// For other backends, use the shared adapter which handles lifecycle
	if (backendName === 'llmist') {
		// The llmist backend needs the full AgentBackendInput, but since it
		// delegates to the existing executors which handle their own lifecycle,
		// we pass a minimal input and let it reconstruct what it needs.
		return backend.execute({
			agentType,
			project: input.project,
			config: input.config,
			repoDir: '',
			systemPrompt: '',
			taskPrompt: '',
			cliToolsDir: '',
			availableTools: [],
			contextInjections: [],
			maxIterations: 0,
			model: '',
			progressReporter: {
				onIteration: async () => {},
				onToolCall: () => {},
				onText: () => {},
			},
			logWriter: () => {},
			agentInput: input,
		});
	}

	return executeWithBackend(backend, agentType, input);
}

export { registerBackend } from '../backends/index.js';
