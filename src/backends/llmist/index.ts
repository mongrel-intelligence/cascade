import { executeAgent } from '../../agents/base.js';
import { executeRespondToCIAgent } from '../../agents/respond-to-ci.js';
import { executeRespondToPRCommentAgent } from '../../agents/respond-to-pr-comment.js';
import { executeRespondToReviewAgent } from '../../agents/respond-to-review.js';
import { executeReviewAgent } from '../../agents/review.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../../types/index.js';
import type { AgentBackend, AgentBackendInput, AgentBackendResult } from '../types.js';

/**
 * Mapping from agent type to its specialized executor function.
 * Agents not listed here fall through to the base `executeAgent()`.
 */
const specializedExecutors: Record<
	string,
	(input: AgentInput & { project: ProjectConfig; config: CascadeConfig }) => Promise<AgentResult>
> = {
	'respond-to-review': (input) =>
		executeRespondToReviewAgent(input as Parameters<typeof executeRespondToReviewAgent>[0]),
	'respond-to-ci': (input) =>
		executeRespondToCIAgent(input as Parameters<typeof executeRespondToCIAgent>[0]),
	'respond-to-pr-comment': (input) =>
		executeRespondToPRCommentAgent(input as Parameters<typeof executeRespondToPRCommentAgent>[0]),
	review: (input) => executeReviewAgent(input as Parameters<typeof executeReviewAgent>[0]),
};

/**
 * llmist backend - wraps the existing llmist-based agent execution.
 *
 * This is the "Option A" approach: the llmist backend delegates to the existing
 * executeAgent()/executeGitHubAgent() functions as-is. The shared adapter from
 * adapter.ts handles lifecycle only for non-llmist backends.
 *
 * In a follow-up, the llmist code can be refactored to also use the shared adapter,
 * but that's not needed for this PR.
 */
export class LlmistBackend implements AgentBackend {
	readonly name = 'llmist';

	supportsAgentType(): boolean {
		return true; // llmist supports all agent types
	}

	async execute(input: AgentBackendInput): Promise<AgentBackendResult> {
		const fullInput: AgentInput & { project: ProjectConfig; config: CascadeConfig } = {
			...input.agentInput,
			project: input.project,
			config: input.config,
		};

		const executor = specializedExecutors[input.agentType];
		const result = executor
			? await executor(fullInput)
			: await executeAgent(input.agentType, fullInput);

		return {
			success: result.success,
			output: result.output,
			prUrl: result.prUrl,
			error: result.error,
			cost: result.cost,
			logBuffer: result.logBuffer,
		};
	}
}
