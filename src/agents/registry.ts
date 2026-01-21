import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { executeAgent } from './base.js';
import { executeRespondToCIAgent } from './respond-to-ci.js';
import { executeRespondToReviewAgent } from './respond-to-review.js';
import { executeReviewAgent } from './review.js';

type AgentExecutor = (
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
) => Promise<AgentResult>;

const agentRegistry = new Map<string, AgentExecutor>();

export function registerAgent(name: string, executor: AgentExecutor): void {
	agentRegistry.set(name, executor);
	logger.debug('Registered agent', { name });
}

export async function runAgent(
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
): Promise<AgentResult> {
	const executor = agentRegistry.get(agentType);

	if (executor) {
		return executor(input);
	}

	// Fall back to base agent execution
	return executeAgent(agentType, input);
}

export function getRegisteredAgents(): string[] {
	return Array.from(agentRegistry.keys());
}

// Register built-in agents
registerAgent('briefing', executeAgent.bind(null, 'briefing'));
registerAgent('planning', executeAgent.bind(null, 'planning'));
registerAgent('implementation', executeAgent.bind(null, 'implementation'));
registerAgent('debug', executeAgent.bind(null, 'debug'));
registerAgent('respond-to-review', (input) =>
	executeRespondToReviewAgent(input as Parameters<typeof executeRespondToReviewAgent>[0]),
);
registerAgent('respond-to-ci', (input) =>
	executeRespondToCIAgent(input as Parameters<typeof executeRespondToCIAgent>[0]),
);
registerAgent('review', (input) =>
	executeReviewAgent(input as Parameters<typeof executeReviewAgent>[0]),
);
