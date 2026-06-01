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
 * Shape of a single parameter entry inside {@link ToolManifest.parameters}.
 *
 * Widened in spec 014 to carry `items`, `aliases`, and a single concrete
 * `example` pulled from the tool definition. These drive both the agent's
 * system-prompt rendering of the flag and (downstream) the CLI factory's
 * help / error output.
 */
export interface ToolManifestParameter {
	/** Base JSON-Schema-ish type: 'string' | 'number' | 'boolean' | 'array' | 'object' */
	type: string;
	/** Whether the flag is required */
	required?: boolean;
	/** Default value (when declared on the tool definition) */
	default?: unknown;
	/** Human-readable description, used as inline help */
	description?: string;
	/** Allowed values for enum-shaped parameters */
	options?: string[];
	/**
	 * Element type for array-shaped parameters.
	 * - `'string'` → CLI flag is repeatable (`--x a --x b`)
	 * - `'object'` → CLI flag takes a single JSON array string
	 */
	items?: string;
	/** Alternative flag names accepted at the CLI (e.g. `['comment']` for `--comments`) */
	aliases?: readonly string[];
	/**
	 * A single concrete example value for this parameter, pulled from the first
	 * {@link ToolDefinition.examples} entry that populates it. Used by the
	 * prompt renderer and CLI help to show agents a runnable shape.
	 */
	example?: unknown;
	/**
	 * MNG-1059: the canonical text parameter name this file-input flag is an
	 * alternative for. Present only on the synthesized `--*-file` manifest
	 * entries (e.g. `body-file` carries `fileInputFor: 'body'`). The prompt
	 * renderer uses this to point agents from a shell-sensitive direct flag at
	 * its safer companion.
	 */
	fileInputFor?: string;
	/**
	 * MNG-1059: the file-input flag name agents should prefer when the payload
	 * for this direct parameter contains markdown, multiline text, backticks,
	 * code fences, `$(...)`, or other shell-sensitive tokens. Present on the
	 * direct text parameter (e.g. `body` carries `fileInputAlternative: 'body-file'`).
	 */
	fileInputAlternative?: string;
}

/**
 * MNG-1427: a single field inside the `success.data` JSON payload a CLI
 * command returns. Mirrors `OutputShapeField` on {@link ToolDefinition} so
 * downstream consumers (prompt renderer, generated help, integration tests)
 * can read the same shape without depending on `src/gadgets/`.
 */
export interface ToolManifestOutputShapeField {
	/** Field key as it appears in `success.data`. */
	name: string;
	/** Type description, e.g. `'string'`, `'number'`, or `'"created" | "updated"'`. */
	type: string;
	/** Optional human-readable explanation. */
	description?: string;
	/** Whether the field may be absent. Defaults to `false`. */
	optional?: boolean;
}

/**
 * MNG-1427: declarative description of the `success.data` payload returned
 * by a CLI command. Surfaced on each {@link ToolManifest} so agents can learn
 * which JSON keys to parse without running the tool first.
 */
export interface ToolManifestOutputShape {
	/** Optional one-line summary of what `success.data` represents. */
	summary?: string;
	/** Field-by-field description of `success.data`. */
	fields: ToolManifestOutputShapeField[];
}

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
	/**
	 * JSON Schema-ish descriptor for the CLI flags/args. Keys are flag names;
	 * values conform to {@link ToolManifestParameter}. Kept as
	 * `Record<string, unknown>` for backwards-compat with older consumers that
	 * index with ad-hoc shapes — new code should cast to `ToolManifestParameter`.
	 */
	parameters: Record<string, unknown>;
	/**
	 * MNG-1427: optional declarative description of the shape of `success.data`
	 * returned by the CLI command. Populated for mutation commands so agents
	 * know which JSON fields to parse without inspecting the response prose.
	 */
	outputShape?: ToolManifestOutputShape;
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
