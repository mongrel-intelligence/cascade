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

import type {
	ToolManifest,
	ToolManifestOutputShape,
	ToolManifestParameter,
} from '../../agents/contracts/index.js';
import { deriveCLICommand } from './cli/commandNames.js';
import { findExampleForParam } from './cli/examples.js';
import type { OutputShape, ParameterDefinition, ToolDefinition } from './toolDefinition.js';

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
	const parameters = buildManifestParameters(def);
	const cliCommand = deriveCLICommand(def.name, cliCommandOverride);

	// MNG-1427: thread the optional output-shape descriptor unchanged into the
	// manifest so downstream consumers (prompt renderer, generated help,
	// integration tests) see the same shape declared on the definition.
	const outputShape = buildManifestOutputShape(def.outputShape);

	return {
		name: def.name,
		description: def.description,
		cliCommand,
		parameters,
		...(outputShape ? { outputShape } : {}),
	};
}

/**
 * Build the `parameters` map for a manifest — including direct params from the
 * definition AND file-input alternative flags. Extracted from
 * {@link generateToolManifest} so the top-level function stays under the
 * cognitive-complexity budget; the rendering rules (gadgetOnly exclusion,
 * file-input cross-references, examples) are unchanged from the original
 * inline code.
 */
function buildManifestParameters(def: ToolDefinition): Record<string, unknown> {
	const parameters: Record<string, unknown> = {};

	// MNG-1059: build a quick lookup of paramName → fileFlag so the manifest
	// can tell the prompt renderer "this direct param has a safer file companion."
	const fileInputAltMap = new Map<string, string>(
		(def.cli?.fileInputAlternatives ?? []).map((a) => [a.paramName, a.fileFlag]),
	);

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
			// MNG-1059: point this direct text/array-of-object param at its
			// safer file companion so the prompt renderer can steer agents away
			// from shell-sensitive inline values.
			const safeCompanion = fileInputAltMap.get(name);
			if (safeCompanion) {
				entry.fileInputAlternative = safeCompanion;
			}
			parameters[name] = entry;
		}
	}

	// Add file-input alternative flags to the manifest
	for (const alt of def.cli?.fileInputAlternatives ?? []) {
		const description =
			alt.description ??
			`Path to file with ${alt.paramName} (prefer over --${alt.paramName} for long content)`;
		parameters[alt.fileFlag] = {
			type: 'string',
			description,
			// MNG-1059: cross-reference back to the direct text param so the
			// prompt renderer can group `--body` and `--body-file` semantically.
			fileInputFor: alt.paramName,
			// File flags are always optional (they are alternatives to the direct param)
		};
	}

	return parameters;
}

function buildManifestOutputShape(
	outputShape: OutputShape | undefined,
): ToolManifestOutputShape | undefined {
	if (!outputShape) return undefined;
	return {
		...(outputShape.summary ? { summary: outputShape.summary } : {}),
		fields: outputShape.fields.map((f) => ({
			name: f.name,
			type: f.type,
			...(f.description ? { description: f.description } : {}),
			...(f.optional ? { optional: true } : {}),
		})),
	};
}
