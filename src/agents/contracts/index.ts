/**
 * Shared type contracts used across both src/agents/ and src/backends/.
 *
 * This module acts as the neutral boundary between the two subsystems,
 * eliminating the bidirectional dependency that previously existed when
 * agents/ imported from backends/types.ts and vice versa.
 *
 * Rule: both src/agents/ and src/backends/ may import from here, but
 * this module must never import from either of them.
 */

/**
 * Function signature for writing structured log lines to the cascade log file.
 * Defined once here to eliminate the three identical duplicate definitions that
 * previously existed across executionPipeline.ts, hooks.ts, and backends/types.ts.
 */
export type LogWriter = (level: string, message: string, context?: Record<string, unknown>) => void;

/**
 * Describes a CASCADE-specific CLI tool available to the agent.
 */
export interface ToolManifest {
	/** Tool name, e.g., 'ReadWorkItem' */
	name: string;
	/** Human-readable description */
	description: string;
	/** CLI command to invoke, e.g., 'cascade-tools trello read-card' */
	cliCommand: string;
	/** JSON Schema for the CLI flags/args */
	parameters: Record<string, unknown>;
}

/**
 * An inline image to be injected into agent context.
 * Backends that support image content blocks (e.g. Claude Code SDK)
 * render these as image content; backends that don't support images
 * simply ignore this field.
 */
export interface ContextImage {
	/** Base64-encoded image data (raw bytes, not a data URI) */
	base64Data: string;
	/** MIME type of the image, e.g. 'image/png', 'image/jpeg' */
	mimeType: string;
	/** Optional alt text describing the image */
	altText?: string;
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
	/**
	 * Optional inline images associated with this context injection.
	 * Populated by fetchWorkItemStep when a work item contains embedded images.
	 * Backends that don't support image rendering simply ignore this field.
	 */
	images?: ContextImage[];
}

/**
 * Callbacks for reporting agent progress to external systems (Trello, GitHub).
 */
export interface ProgressReporter {
	onIteration(iteration: number, maxIterations: number): Promise<void>;
	onToolCall(toolName: string, params?: Record<string, unknown>): void;
	onText(content: string): void;
	onTaskCompleted?(taskId: string, subject: string, summary: string): void;
}

/**
 * Minimal interface for ProgressMonitor used by agents.
 * The full ProgressMonitor class lives in src/backends/progressMonitor.ts;
 * agents only need this structural interface to avoid depending on backends/.
 */
export interface IProgressMonitor extends ProgressReporter {
	onIteration(iteration: number, maxIterations: number): Promise<void>;
	onToolCall(toolName: string, params?: Record<string, unknown>): void;
	onText(content: string): void;
}
