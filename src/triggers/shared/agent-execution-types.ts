import type { LifecycleHooks } from '../../agents/definitions/schema.js';
import type { PMLifecycleManager, PMProvider } from '../../pm/index.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../../types/index.js';
import type { TriggerResult } from '../types.js';

/**
 * Configuration for source-specific behavior in the agent execution pipeline.
 */
export interface AgentExecutionConfig {
	/**
	 * Whether to skip calling lifecycle.prepareForAgent before running the agent.
	 * GitHub handlers skip this step; Trello and JIRA handlers call it.
	 */
	skipPrepareForAgent?: boolean;

	/**
	 * Whether to skip calling lifecycle.handleFailure on agent failure.
	 * GitHub handlers only call handleSuccess for the 'implementation' agent type,
	 * so they skip handleFailure entirely.
	 */
	skipHandleFailure?: boolean;

	/**
	 * Whether to only call lifecycle.handleSuccess for a specific agent type.
	 * If set, handleSuccess is only called when agentType matches this value.
	 * GitHub uses this to only call handleSuccess for 'implementation'.
	 */
	handleSuccessOnlyForAgentType?: string;

	/**
	 * Optional callback invoked when the agent succeeds (after pipeline completes).
	 * Used by GitHub to delete the progress comment for non-implementation agents.
	 */
	onSuccess?: (result: TriggerResult, agentResult: AgentResult) => Promise<void>;

	/**
	 * Optional callback invoked when the agent fails (after pipeline completes).
	 * Used by GitHub to update the PR comment with an error message.
	 */
	onFailure?: (result: TriggerResult, agentResult: AgentResult) => Promise<void>;

	/**
	 * Log label used in log messages (e.g. 'GitHub', 'JIRA', 'Trello').
	 */
	logLabel?: string;
}

/**
 * Internal context assembled by runAgentExecutionPipeline once source-specific
 * configuration, lifecycle dependencies, and live work-item state are resolved.
 */
export interface AgentExecutionContext {
	result: TriggerResult;
	project: ProjectConfig;
	config: CascadeConfig;
	executionConfig: AgentExecutionConfig;
	agentType: string;
	logLabel: string;
	/**
	 * Active PM provider for the project. Reused by the freshness gate so it
	 * does not have to instantiate a parallel provider state. Mirrors what
	 * the lifecycle manager already wraps internally.
	 */
	pmProvider: PMProvider;
	lifecycle: PMLifecycleManager;
	lifecycleHooks: LifecycleHooks;
	workItemId: string | undefined;
	agentInput: AgentInput;
}
