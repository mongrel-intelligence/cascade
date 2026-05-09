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

import type { ToolManifest, ToolManifestParameter } from '../../agents/contracts/index.js';
import { deriveCLICommand } from './cli/commandNames.js';
import { findExampleForParam } from './cli/examples.js';
import type { ParameterDefinition, ToolDefinition } from './toolDefinition.js';

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
): ToolManifestParameter | undefined {
	// gadgetOnly params are excluded from manifests
	if (def.gadgetOnly) return undefined;

	const entry: ToolManifestParameter = {
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

	// Spec 014: thread array items, aliases, and example values through to the manifest
	if (def.type === 'array') {
		entry.items = def.items;
	}

	if (def.cliAliases && def.cliAliases.length > 0) {
		entry.aliases = [...def.cliAliases];
	}

	return entry;
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
			const example = findExampleForParam(def.examples, name);
			if (example !== undefined) {
				entry.example = example;
			}
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
