import type { AgentInput, CascadeConfig, ProjectConfig } from '../types/index.js';

// Re-export shared contracts so downstream code that imports from here continues to work.
export type {
	ContextInjection,
	LogWriter,
	ProgressReporter,
	ToolManifest,
} from '../agents/contracts/index.js';

import type {
	ContextInjection,
	LogWriter,
	ProgressReporter,
	ToolManifest,
} from '../agents/contracts/index.js';

/**
 * Input provided to an AgentBackend for execution.
 */
export interface AgentBackendInput {
	agentType: string;
	project: ProjectConfig;
	config: CascadeConfig;
	repoDir: string;
	systemPrompt: string;
	taskPrompt: string;
	cliToolsDir: string;
	availableTools: ToolManifest[];
	contextInjections: ContextInjection[];
	maxIterations: number;
	budgetUsd?: number;
	model: string;
	progressReporter: ProgressReporter;
	logWriter: LogWriter;
	agentInput: AgentInput;
	/** Per-project secrets to inject into subprocess environment */
	projectSecrets?: Record<string, string>;
	/** Database run ID for real-time LLM call logging */
	runId?: string;
	/** SDK tools to allow (defaults to all 6: Read, Write, Edit, Bash, Glob, Grep) */
	sdkTools?: string[];
	/** Whether to enable stop hooks that check for uncommitted/unpushed changes (defaults to true) */
	enableStopHooks?: boolean;
	/** Whether to block git push in hooks (defaults to true) */
	blockGitPush?: boolean;
	/** Path where the llmist SDK should write its structured log (workspace dir, not temp) */
	llmistLogPath?: string;
}

/**
 * Result returned by an AgentBackend after execution.
 */
export interface AgentBackendResult {
	success: boolean;
	output: string;
	prUrl?: string;
	error?: string;
	cost?: number;
	logBuffer?: Buffer;
	runId?: string;
}

/**
 * Interface that all agent backends must implement.
 * This is the core abstraction that makes agent execution pluggable.
 */
export interface AgentBackend {
	/** Unique name for this backend, e.g., 'llmist', 'claude-code' */
	readonly name: string;

	/** Execute an agent with the given input */
	execute(input: AgentBackendInput): Promise<AgentBackendResult>;

	/** Check whether this backend supports the given agent type */
	supportsAgentType(agentType: string): boolean;
}
