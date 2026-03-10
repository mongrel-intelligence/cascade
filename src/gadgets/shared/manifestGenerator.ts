/**
 * Generator for ToolManifest objects from a ToolDefinition.
 *
 * Converts a unified ToolDefinition into the ToolManifest shape expected by
 * agents and backends — the JSON Schema-style parameter description used to
 * describe CASCADE tools to the agent in its system prompt.
 *
 * Key rules:
 * - Parameters with `gadgetOnly: true` are EXCLUDED (they are internal to gadgets)
 * - File-input alternative flags from `cli.fileInputAlternatives` are INCLUDED
 *   (they appear in the CLI manifest as standalone parameters)
 * - The `cliCommand` is derived from the definition name (kebab-cased)
 */

import type { ToolManifest } from '../../agents/contracts/index.js';
import type { ParameterDefinition, ToolDefinition } from './toolDefinition.js';

// ---------------------------------------------------------------------------
// Parameter schema entry type (ToolManifest.parameters value)
// ---------------------------------------------------------------------------

interface ManifestParameterEntry {
	type: string;
	required?: boolean;
	default?: unknown;
	description?: string;
	options?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a ParameterDefinition to the manifest parameter shape.
 * Returns undefined for gadgetOnly parameters (excluded from manifest).
 */
function buildManifestParam(
	def: ParameterDefinition,
	isRequired: boolean,
): ManifestParameterEntry | undefined {
	// gadgetOnly params are excluded from manifests
	if (def.gadgetOnly) return undefined;

	const entry: ManifestParameterEntry = {
		type: def.type === 'array' ? 'array' : def.type === 'object' ? 'object' : def.type,
		...(isRequired ? { required: true } : {}),
		...('default' in def && def.default !== undefined ? { default: def.default } : {}),
	};

	// Add description if it differs from the standard describe field
	// For manifest params, use the describe field as the description
	if (def.describe) {
		entry.description = def.describe;
	}

	// Add enum options if present
	if (def.type === 'enum' && def.options) {
		entry.options = [...def.options];
		// Change type to 'string' for enum (JSON Schema convention)
		entry.type = 'string';
	}

	return entry;
}

/**
 * Convert a PascalCase or camelCase tool name to a kebab-case CLI command segment.
 *
 * Examples:
 * - 'PostComment' → 'post-comment'
 * - 'ReadWorkItem' → 'read-work-item'
 * - 'CreatePR' → 'create-pr'
 */
function toKebabCase(name: string): string {
	return name
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
		.replace(/([a-z\d])([A-Z])/g, '$1-$2')
		.toLowerCase();
}

/**
 * Derive the CLI command prefix for a tool based on its category.
 *
 * The tool name prefix determines whether it's a PM, SCM, or session tool:
 * - PM tools: ReadWorkItem, PostComment, UpdateWorkItem, CreateWorkItem, ListWorkItems,
 *             AddChecklist, MoveWorkItem, PMUpdateChecklistItem, PMDeleteChecklistItem
 * - SCM tools: CreatePR, GetPR*, PostPRComment, UpdatePRComment, ReplyToReviewComment,
 *              CreatePRReview, GetCIRunLogs
 * - Session tools: Finish
 *
 * Falls back to 'cascade-tools pm' if the category cannot be determined.
 */
function deriveCLICommand(toolName: string, cliCommandOverride?: string): string {
	if (cliCommandOverride) return cliCommandOverride;

	// Session tools
	if (toolName === 'Finish') {
		return `cascade-tools session ${toKebabCase(toolName)}`;
	}

	// SCM tools: PR-related, CI-related
	const scmPrefixes = [
		'createpr',
		'getpr',
		'postpr',
		'updatepr',
		'replytoreview',
		'createprreview',
		'getciru',
	];
	const lowerName = toolName.toLowerCase();
	if (
		scmPrefixes.some((p) => lowerName.startsWith(p)) ||
		lowerName.includes('pr') ||
		lowerName.includes('ci')
	) {
		// Verify it is truly an SCM tool
		if (
			toolName.startsWith('CreatePR') ||
			toolName.startsWith('GetPR') ||
			toolName.startsWith('PostPR') ||
			toolName.startsWith('UpdatePR') ||
			toolName.startsWith('ReplyTo') ||
			toolName === 'GetCIRunLogs'
		) {
			return `cascade-tools scm ${toKebabCase(toolName)}`;
		}
	}

	// PM tools: Strip "PM" prefix if present (e.g., PMUpdateChecklistItem → update-checklist-item)
	// to avoid double "pm" prefix (cascade-tools pm pm-update-checklist-item)
	let commandName = toolName;
	if (toolName.startsWith('PM') && toolName.length > 2 && /[A-Z]/.test(toolName[2])) {
		commandName = toolName.slice(2);
	}

	return `cascade-tools pm ${toKebabCase(commandName)}`;
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Generates a ToolManifest object from a ToolDefinition.
 *
 * The manifest is used by agents to understand what tools are available and
 * how to call them via the CLI.
 *
 * @param def - The tool definition to convert
 * @param cliCommandOverride - Optional explicit CLI command (e.g., 'cascade-tools pm post-comment').
 *   If omitted, the command is derived from the tool name.
 *
 * @example
 * ```typescript
 * const manifest = generateToolManifest(postCommentDef, 'cascade-tools pm post-comment');
 * // → {
 * //   name: 'PostComment',
 * //   description: 'Post a comment...',
 * //   cliCommand: 'cascade-tools pm post-comment',
 * //   parameters: {
 * //     workItemId: { type: 'string', required: true },
 * //     text: { type: 'string', required: true },
 * //     'text-file': { type: 'string', description: '...' },
 * //   }
 * // }
 * ```
 */
export function generateToolManifest(
	def: ToolDefinition,
	cliCommandOverride?: string,
): ToolManifest {
	const parameters: Record<string, unknown> = {};

	for (const [name, paramDef] of Object.entries(def.parameters)) {
		// Skip gadgetOnly params
		if (paramDef.gadgetOnly) continue;

		const isRequired = paramDef.required === true;
		const entry = buildManifestParam(paramDef, isRequired);
		if (entry) {
			parameters[name] = entry;
		}
	}

	// Add file-input alternative flags to the manifest
	if (def.cli?.fileInputAlternatives) {
		for (const alt of def.cli.fileInputAlternatives) {
			const description =
				alt.description ??
				`Path to file with ${alt.paramName} (prefer over --${alt.paramName} for long content)`;
			parameters[alt.fileFlag] = {
				type: 'string',
				description,
				// File flags are always optional (they are alternatives to the direct param)
			};
		}
	}

	const cliCommand = deriveCLICommand(def.name, cliCommandOverride);

	return {
		name: def.name,
		description: def.description,
		cliCommand,
		parameters,
	};
}
