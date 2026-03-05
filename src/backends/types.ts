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

// ============================================================================
// MCP Server Configuration Types
// ============================================================================

/**
 * MCP server delivered as a stdio subprocess.
 * The server is launched as a child process; Cascade can inject project secrets
 * into its environment via the `env` field.
 */
export interface McpStdioConfig {
	type: 'stdio';
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

/**
 * MCP server delivered over SSE (HTTP streaming).
 * Used for remote MCP servers running on a known URL.
 */
export interface McpSSEConfig {
	type: 'sse';
	url: string;
	headers?: Record<string, string>;
}

/**
 * MCP server delivered over streamable HTTP.
 * Modern alternative to SSE for remote MCP servers.
 */
export interface McpHttpConfig {
	type: 'http';
	url: string;
	headers?: Record<string, string>;
}

/** Union of all supported MCP server transport configurations. */
export type McpServerConfig = McpStdioConfig | McpSSEConfig | McpHttpConfig;

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
	/**
	 * MCP servers to connect to during agent execution.
	 * Keys are server names; values are transport configs.
	 * Currently supported by the Claude Code backend only.
	 * The llmist backend will log a warning and skip MCP servers.
	 */
	mcpServers?: Record<string, McpServerConfig>;
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
