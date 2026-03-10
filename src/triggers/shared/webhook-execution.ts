/**
 * Shared agent execution wrapper for webhook handlers.
 *
 * Factors out the common credential-nesting pattern used by all webhook handlers
 * (Trello, Jira, GitHub):
 *
 *   injectLlmApiKeys
 *     → integration.withCredentials
 *       → withEmailIntegration
 *       → withGitHubToken (persona token)
 *             → runAgentExecutionPipeline
 *
 * Source-specific behavior (e.g. GitHub skipping PM lifecycle steps) is controlled
 * via the optional `AgentExecutionConfig` returned by `integration.resolveExecutionConfig?.()`.
 */

import { withEmailIntegration } from '../../email/index.js';
import { withGitHubToken } from '../../github/client.js';
import { getPersonaToken } from '../../github/personas.js';
import type { PMIntegration } from '../../pm/integration.js';
import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import { injectLlmApiKeys } from '../../utils/llmEnv.js';
import type { TriggerResult } from '../types.js';
import type { AgentExecutionConfig } from './agent-execution.js';
import { runAgentExecutionPipeline } from './agent-execution.js';

/**
 * Run the agent execution pipeline inside the full credential scope.
 *
 * Wraps `runAgentExecutionPipeline` in the standard nesting:
 *   LLM env → PM credentials → email integration → GitHub token
 *
 * The `executionConfig` controls source-specific lifecycle overrides (e.g. GitHub
 * skips `prepareForAgent` and `handleFailure` since those are PR-based, not card-based).
 */
export async function runAgentWithCredentials(
	integration: PMIntegration,
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
	executionConfig?: AgentExecutionConfig,
): Promise<void> {
	if (!result.agentType) return;

	const githubToken = await getPersonaToken(project.id, result.agentType);
	const restoreLlmEnv = await injectLlmApiKeys(project.id);

	const resolvedConfig: AgentExecutionConfig = executionConfig ?? {
		logLabel: `${integration.type} agent`,
	};

	try {
		await integration.withCredentials(project.id, () =>
			withEmailIntegration(project.id, () =>
				withGitHubToken(githubToken, () =>
					runAgentExecutionPipeline(result, project, config, resolvedConfig),
				),
			),
		);
	} finally {
		restoreLlmEnv();
	}
}
