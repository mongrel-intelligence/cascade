/**
 * Unified ToolDefinition type — single source of truth for tool metadata.
 *
 * This type captures everything about a tool:
 * - Core identity: name, description, timeout
 * - Parameter definitions (typed, with required/optional/default/describe support)
 * - Examples for documentation and agent prompts
 * - CLI-specific metadata: file-input alternatives, auto-resolved fields, env vars
 * - Hook types for gadget and CLI post-execute lifecycle
 *
 * Parameter types map to:
 * - Zod schemas (for Gadgets)
 * - oclif Flags (for CLI)
 * - JSON Schema (for manifests)
 */

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

/**
 * All supported parameter types.
 *
 * - `string`  → z.string() / Flags.string()  / JSON Schema "string"
 * - `number`  → z.number() / Flags.integer() / JSON Schema "number"
 * - `boolean` → z.boolean() / Flags.boolean() / JSON Schema "boolean"
 * - `enum`    → z.enum()   / Flags.string({options}) / JSON Schema "string" with enum
 * - `array`   → z.array()  / Flags.string({multiple: true}) / JSON Schema "array"
 * - `object`  → z.object() / Flags.string() (JSON-encoded) / JSON Schema "object"
 */
export type ParameterType = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object';

/**
 * Describes a file-input alternative for a text parameter.
 *
 * When a CLI parameter supports reading content from a file (e.g., `--text` and
 * `--text-file`), this type captures that relationship.
 *
 * @example
 * // text param → text-file flag (read comment from file or stdin)
 * { paramName: 'text', fileFlag: 'text-file', description: 'Read comment text from file (use - for stdin)' }
 *
 * // body param → body-file flag (read PR body from file)
 * { paramName: 'body', fileFlag: 'body-file', description: 'Read PR body from file (use - for stdin)' }
 */
export interface FileInputAlternative {
	/** The name of the text parameter this file flag is an alternative for */
	paramName: string;
	/** The CLI flag name for the file input (e.g., 'text-file', 'body-file') */
	fileFlag: string;
	/** Optional description for the file flag in CLI help output */
	description?: string;
}

/**
 * Marks a parameter as auto-resolved in the CLI from environment variables or
 * git remote detection, making it optional in the CLI even if required in the gadget.
 *
 * @example
 * // owner/repo auto-resolved from CASCADE_REPO_OWNER / CASCADE_REPO_NAME or git remote
 * { paramName: 'owner', envVar: 'CASCADE_REPO_OWNER', resolvedFrom: 'git-remote' }
 * { paramName: 'repo',  envVar: 'CASCADE_REPO_NAME',  resolvedFrom: 'git-remote' }
 */
export interface CLIAutoResolved {
	/** The parameter name in the tool definition */
	paramName: string;
	/**
	 * The environment variable that can supply this value automatically.
	 * When set, the CLI flag is optional.
	 */
	envVar?: string;
	/**
	 * Additional resolution strategy beyond environment variables.
	 * - `'git-remote'`: Parse owner/repo from the `origin` git remote URL.
	 */
	resolvedFrom?: 'git-remote';
	/** Optional CLI description override (e.g., "Repository owner (auto-detected)") */
	description?: string;
}

// ---------------------------------------------------------------------------
// Per-parameter definition
// ---------------------------------------------------------------------------

/**
 * Base fields common to all parameter definitions.
 */
interface BaseParameterDefinition {
	/** Human-readable description shown in CLI help and manifests */
	describe: string;
	/**
	 * Whether this parameter is required.
	 * Exactly one of `required` or `optional` should be set to `true`.
	 * Defaults to required if neither is specified.
	 */
	required?: boolean;
	/** Whether this parameter is optional */
	optional?: boolean;
	/**
	 * If `true`, this parameter is used only by the Gadget (e.g., `comment`/rationale
	 * fields) and should NOT appear in the CLI flags or JSON Schema manifest.
	 */
	gadgetOnly?: boolean;
	/**
	 * CLI environment variable that can auto-populate this parameter.
	 * Maps to `env` in oclif `Flags` definition.
	 *
	 * @example 'CASCADE_BASE_BRANCH' for the `base` param in CreatePR
	 */
	cliEnvVar?: string;
}

/**
 * String parameter definition.
 */
export interface StringParameterDefinition extends BaseParameterDefinition {
	type: 'string';
	/** Default value (used in Zod .default() and oclif Flags default) */
	default?: string;
}

/**
 * Number parameter definition.
 */
export interface NumberParameterDefinition extends BaseParameterDefinition {
	type: 'number';
	/** Default value */
	default?: number;
	/** Minimum value (maps to z.number().min()) */
	min?: number;
	/** Maximum value (maps to z.number().max()) */
	max?: number;
}

/**
 * Boolean parameter definition.
 */
export interface BooleanParameterDefinition extends BaseParameterDefinition {
	type: 'boolean';
	/** Default value */
	default?: boolean;
	/**
	 * Whether the CLI flag supports `--no-<flag>` negation syntax.
	 * Maps to oclif `Flags.boolean({ allowNo: true })`.
	 */
	allowNo?: boolean;
}

/**
 * Enum parameter definition — restricts values to a fixed set of strings.
 */
export interface EnumParameterDefinition extends BaseParameterDefinition {
	type: 'enum';
	/** The allowed string values */
	options: readonly string[];
	/** Default value (must be one of `options`) */
	default?: string;
}

/**
 * Array parameter definition — a list of values.
 *
 * In the CLI, repeatable flags (`--item foo --item bar`) are used when
 * `multiple: true` is set on oclif Flags.
 */
export interface ArrayParameterDefinition extends BaseParameterDefinition {
	type: 'array';
	/** The type of each element in the array */
	items: ParameterType;
	/**
	 * Whether the CLI flag can be repeated to build an array.
	 * Maps to oclif `Flags.string({ multiple: true })`.
	 * Default: `true` for array type.
	 */
	multiple?: boolean;
}

/**
 * Object parameter definition — an arbitrary nested object.
 * In the CLI this is passed as a JSON-encoded string.
 */
export interface ObjectParameterDefinition extends BaseParameterDefinition {
	type: 'object';
	/** Default value (serialized as JSON string in CLI) */
	default?: Record<string, unknown>;
}

/**
 * Union of all supported parameter definition shapes.
 */
export type ParameterDefinition =
	| StringParameterDefinition
	| NumberParameterDefinition
	| BooleanParameterDefinition
	| EnumParameterDefinition
	| ArrayParameterDefinition
	| ObjectParameterDefinition;

/**
 * A record mapping parameter names to their definitions.
 */
export type ParameterMap = Record<string, ParameterDefinition>;

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

/**
 * A single example invocation for a tool.
 * Used in documentation, manifests, and agent prompts.
 */
export interface ToolExample {
	/** The parameter values for this example call */
	params: Record<string, unknown>;
	/** Optional expected output (for documentation) */
	output?: string;
	/** Human-readable description of what this example demonstrates */
	comment?: string;
}

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

/**
 * Post-execute hook called after the Gadget's `execute()` returns.
 *
 * Receives the raw output string and the params used, and may return a
 * transformed output string or void.
 *
 * @example
 * async (output, params) => {
 *   recordPRCreation(output);
 *   return output;
 * }
 */
export type GadgetPostExecuteHook = (
	output: string,
	params: Record<string, unknown>,
) => Promise<string | undefined> | string | undefined;

/**
 * Post-execute hook called after the CLI command's core logic completes.
 *
 * Receives the result object and the parsed CLI flags, and may perform
 * additional side effects (e.g., printing extra output, updating state).
 *
 * @example
 * async (result, flags) => {
 *   console.log('PR URL:', result.prUrl);
 * }
 */
export type CLIPostExecuteHook = (
	result: unknown,
	flags: Record<string, unknown>,
) => Promise<void> | void;

// ---------------------------------------------------------------------------
// CLI metadata
// ---------------------------------------------------------------------------

/**
 * CLI-specific metadata attached to a tool definition.
 * Controls how the CLI adapter generates flags and handles special behaviors.
 */
export interface CLIToolMetadata {
	/**
	 * Parameters that have file-input alternatives in the CLI.
	 *
	 * For each entry, the CLI generates an additional `--<fileFlag>` flag
	 * that reads the parameter value from a file (or stdin with `-`).
	 *
	 * @example [{ paramName: 'text', fileFlag: 'text-file' }]
	 */
	fileInputAlternatives?: FileInputAlternative[];

	/**
	 * Parameters that are auto-resolved in the CLI from env vars or git remote.
	 *
	 * These parameters are optional in the CLI even if marked required in the
	 * parameter map, because they can be detected automatically.
	 *
	 * @example [{ paramName: 'owner', envVar: 'CASCADE_REPO_OWNER', resolvedFrom: 'git-remote' }]
	 */
	autoResolved?: CLIAutoResolved[];

	/**
	 * Post-execute hook for the CLI command.
	 * Called after the core logic completes successfully.
	 */
	postExecute?: CLIPostExecuteHook;
}

// ---------------------------------------------------------------------------
// Top-level ToolDefinition
// ---------------------------------------------------------------------------

/**
 * Unified tool definition — single source of truth for all tool metadata.
 *
 * This interface is the foundation for:
 * - Generating Zod schemas for Gadget parameter validation
 * - Generating oclif CLI flag definitions
 * - Generating JSON Schema manifests
 * - Producing documentation and agent-facing examples
 *
 * @example
 * const postCommentDef: ToolDefinition = {
 *   name: 'PostComment',
 *   description: 'Post a comment to a work item.',
 *   timeoutMs: 30000,
 *   parameters: {
 *     comment: { type: 'string', describe: 'Brief rationale', gadgetOnly: true },
 *     workItemId: { type: 'string', describe: 'The work item ID', required: true },
 *     text: { type: 'string', describe: 'The comment text (supports markdown)', required: true },
 *   },
 *   examples: [
 *     {
 *       params: { comment: 'Posting status update', workItemId: 'abc123', text: 'Done!' },
 *       comment: 'Post a status update to the work item',
 *     },
 *   ],
 *   cli: {
 *     fileInputAlternatives: [{ paramName: 'text', fileFlag: 'text-file' }],
 *   },
 * };
 */
export interface ToolDefinition {
	/**
	 * Unique tool name (PascalCase for gadgets, kebab-case for CLI commands).
	 * @example 'PostComment', 'CreatePR', 'GetPRDetails'
	 */
	name: string;

	/**
	 * Human-readable description of the tool's purpose.
	 * Shown in CLI help, agent prompts, and manifests.
	 * Supports markdown.
	 */
	description: string;

	/**
	 * Execution timeout in milliseconds.
	 * The gadget/CLI command will fail if it does not complete within this time.
	 * @default 30000 (30 seconds)
	 */
	timeoutMs?: number;

	/**
	 * Parameter definitions — the schema for inputs this tool accepts.
	 *
	 * Keys are parameter names; values describe type, validation, and metadata.
	 * The `gadgetOnly` flag on a parameter excludes it from CLI flags and manifests.
	 */
	parameters: ParameterMap;

	/**
	 * Example invocations for documentation, manifests, and agent prompts.
	 */
	examples?: ToolExample[];

	/**
	 * CLI-specific metadata: file-input alternatives, auto-resolved fields,
	 * and post-execute hooks. Omit for gadgets that have no CLI counterpart.
	 */
	cli?: CLIToolMetadata;

	/**
	 * Post-execute hook for the Gadget.
	 * Called after `execute()` returns, before the result is returned to the agent.
	 */
	gadgetPostExecute?: GadgetPostExecuteHook;
}
