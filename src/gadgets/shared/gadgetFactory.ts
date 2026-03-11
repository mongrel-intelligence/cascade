/**
 * Factory function for creating llmist Gadget classes from a ToolDefinition.
 *
 * Given a ToolDefinition and a core async function, this factory generates:
 * - A Zod schema from the parameter definitions (filtering out CLI-only params is N/A here,
 *   but gadgetOnly params ARE included — they are used exclusively by the gadget)
 * - An execute method wired to the provided coreFn
 * - A class extending the llmist Gadget base with all metadata set
 */

import { Gadget, type GadgetExample, z } from 'llmist';
import type {
	GadgetPostExecuteHook,
	ParameterDefinition,
	ParameterMap,
	ToolDefinition,
} from './toolDefinition.js';

// ---------------------------------------------------------------------------
// Zod schema generation from ParameterMap
// ---------------------------------------------------------------------------

// Use permissive types to work with both Zod v3 and v4
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyZodType = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyZodShape = Record<string, any>;

/**
 * Build a single Zod field from a ParameterDefinition.
 */
function buildZodField(def: ParameterDefinition): AnyZodType {
	let field: AnyZodType;

	switch (def.type) {
		case 'string': {
			field = z.string();
			break;
		}
		case 'number': {
			let n = z.number();
			if (def.min !== undefined) n = n.min(def.min);
			if (def.max !== undefined) n = n.max(def.max);
			field = n;
			break;
		}
		case 'boolean': {
			field = z.boolean();
			break;
		}
		case 'enum': {
			// z.enum requires a non-empty tuple with at least one value
			const [first, ...rest] = def.options;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			field = (z.enum as any)([first, ...rest] as [string, ...string[]]);
			break;
		}
		case 'array': {
			// Build the item schema based on the items type
			let itemSchema: AnyZodType;
			switch (def.items) {
				case 'string':
					itemSchema = z.string();
					break;
				case 'number':
					itemSchema = z.number();
					break;
				case 'boolean':
					itemSchema = z.boolean();
					break;
				default:
					itemSchema = z.unknown();
			}
			field = z.array(itemSchema);
			break;
		}
		case 'object': {
			// Use z.record with key + value in Zod v4, or just z.record(z.unknown()) in v3
			// Since llmist re-exports Zod v4, use z.string() key type
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			field = (z as any).record(z.string(), z.unknown());
			break;
		}
		default: {
			const _exhaustive: never = def;
			throw new Error(`Unknown parameter type: ${(_exhaustive as ParameterDefinition).type}`);
		}
	}

	// Add description
	field = field.describe(def.describe);

	// Handle optional: apply before default so .optional().default() works correctly
	if (def.optional === true) {
		field = field.optional();
	}

	// Handle default values
	if ('default' in def && def.default !== undefined) {
		field = field.default(def.default);
	}

	return field;
}

/**
 * Convert a ParameterMap to a Zod object schema.
 * Gadget schemas include ALL parameters (including gadgetOnly params like `comment`).
 */
export function buildZodSchema(parameters: ParameterMap): AnyZodType {
	const shape: AnyZodShape = {};

	for (const [name, def] of Object.entries(parameters)) {
		shape[name] = buildZodField(def);
	}

	return z.object(shape);
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Core function signature for gadgets.
 * Receives the parsed params and returns a string result.
 */
export type GadgetCoreFn<TParams extends Record<string, unknown> = Record<string, unknown>> = (
	params: TParams,
) => Promise<string> | string;

/**
 * Creates a llmist Gadget class from a ToolDefinition and a core function.
 *
 * The generated class:
 * - Extends `Gadget({...})` with the correct name, description, timeoutMs, and schema
 * - Implements `execute(params)` by delegating to `coreFn`
 * - Applies `gadgetPostExecute` hook if defined in the definition
 * - Includes all parameters in the schema (gadgetOnly params like `comment` ARE included)
 *
 * @example
 * ```typescript
 * export const PostComment = createGadgetClass(postCommentDef, async (params) => {
 *   return postComment(params.workItemId, params.text);
 * });
 * ```
 */
export function createGadgetClass(
	def: ToolDefinition,
	coreFn: GadgetCoreFn,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): new () => any {
	const schema = buildZodSchema(def.parameters);

	// Map ToolExample to GadgetExample
	const examples: GadgetExample[] | undefined = def.examples?.map((ex) => ({
		params: ex.params,
		output: ex.output,
		comment: ex.comment,
	}));

	const postExecute: GadgetPostExecuteHook | undefined = def.gadgetPostExecute;

	const GadgetBase = Gadget({
		name: def.name,
		description: def.description,
		timeoutMs: def.timeoutMs,
		schema,
		...(examples ? { examples } : {}),
	});

	class FactoryGadget extends GadgetBase {
		override async execute(params: this['params']): Promise<string> {
			const rawParams = params as Record<string, unknown>;
			const result = await coreFn(rawParams);

			if (postExecute) {
				const transformed = await postExecute(result, rawParams);
				return transformed ?? result;
			}

			return result;
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return FactoryGadget as unknown as new () => any;
}
