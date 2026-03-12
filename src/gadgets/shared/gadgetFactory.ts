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

type GadgetClass = new () => {
	execute(params: Record<string, unknown>): Promise<string>;
};
type GadgetExampleParams = Record<
	string,
	string | number | boolean | string[] | number[] | boolean[] | unknown[] | Record<string, unknown>
>;

interface SchemaLike {
	describe(description: string): SchemaLike;
	optional(): SchemaLike;
	default(value: unknown): SchemaLike;
}

function applyFieldModifiers<T extends SchemaLike>(field: T, def: ParameterDefinition): T {
	let nextField = field;

	nextField = nextField.describe(def.describe) as T;

	if (def.optional === true) {
		nextField = nextField.optional() as T;
	}

	if ('default' in def && def.default !== undefined) {
		nextField = nextField.default(def.default) as T;
	}

	return nextField;
}

function buildArrayField(def: Extract<ParameterDefinition, { type: 'array' }>) {
	switch (def.items) {
		case 'string':
			return z.array(z.string());
		case 'number':
			return z.array(z.number());
		case 'boolean':
			return z.array(z.boolean());
		case 'object':
			// Allow strings or objects for flexible items (e.g. AddChecklist items)
			return z.array(z.union([z.string(), z.object({}).passthrough()]));
		default:
			return z.array(z.unknown());
	}
}

/**
 * Build a single Zod field from a ParameterDefinition.
 */
function buildZodField(def: ParameterDefinition) {
	switch (def.type) {
		case 'string': {
			return applyFieldModifiers(z.string(), def);
		}
		case 'number': {
			let n = z.number();
			if (def.min !== undefined) n = n.min(def.min);
			if (def.max !== undefined) n = n.max(def.max);
			return applyFieldModifiers(n, def);
		}
		case 'boolean': {
			return applyFieldModifiers(z.boolean(), def);
		}
		case 'enum': {
			// z.enum requires a non-empty tuple with at least one value
			const [first, ...rest] = def.options;
			return applyFieldModifiers(z.enum([first, ...rest] as [string, ...string[]]), def);
		}
		case 'array': {
			return applyFieldModifiers(buildArrayField(def), def);
		}
		case 'object': {
			return applyFieldModifiers(z.object({}).passthrough(), def);
		}
		default: {
			const _exhaustive: never = def;
			throw new Error(`Unknown parameter type: ${(_exhaustive as ParameterDefinition).type}`);
		}
	}
}

/**
 * Convert a ParameterMap to a Zod object schema.
 * Gadget schemas include ALL parameters (including gadgetOnly params like `comment`).
 */
export function buildZodSchema(parameters: ParameterMap) {
	const shape: Record<string, ReturnType<typeof buildZodField>> = {};

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
export function createGadgetClass(def: ToolDefinition, coreFn: GadgetCoreFn): GadgetClass {
	const schema = buildZodSchema(def.parameters);

	// Map ToolExample to GadgetExample
	const examples: GadgetExample<GadgetExampleParams>[] | undefined = def.examples?.map((ex) => ({
		params: ex.params as GadgetExampleParams,
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
		...(def.exclusive ? { exclusive: true } : {}),
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

	return FactoryGadget as unknown as GadgetClass;
}
