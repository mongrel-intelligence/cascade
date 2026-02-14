import type { AgentInput, CascadeConfig, ProjectConfig } from '../types/index.js';

/**
 * Describes a CASCADE-specific CLI tool available to the agent.
 */
export interface ToolManifest {
	/** Tool name, e.g., 'ReadTrelloCard' */
	name: string;
	/** Human-readable description */
	description: string;
	/** CLI command to invoke, e.g., 'cascade-tools trello read-card' */
	cliCommand: string;
	/** JSON Schema for the CLI flags/args */
	parameters: Record<string, unknown>;
}

/**
 * Pre-fetched data injected into agent context before execution.
 * Each backend decides how to present this (llmist: synthetic gadget calls,
 * Claude Code SDK: system prompt data, etc.)
 */
export interface ContextInjection {
	/** Gadget/tool name that produced this data, e.g., 'ReadTrelloCard' */
	toolName: string;
	/** Parameters used to fetch the data */
	params: Record<string, unknown>;
	/** The fetched result text */
	result: string;
	/** Human-readable description of this data */
	description: string;
}

/**
 * Callbacks for reporting agent progress to external systems (Trello, GitHub).
 */
export interface ProgressReporter {
	onIteration(iteration: number, maxIterations: number): Promise<void>;
	onToolCall(toolName: string, params?: Record<string, unknown>): void;
	onText(content: string): void;
}

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
}

export type LogWriter = (level: string, message: string, context?: Record<string, unknown>) => void;

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
