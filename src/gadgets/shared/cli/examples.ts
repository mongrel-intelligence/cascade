import type {
	OutputShape,
	OutputShapeField,
	ParameterDefinition,
	ToolDefinition,
	ToolExample,
} from '../toolDefinition.js';
import { formatJsonExample, formatShellScalar, shellQuote } from './shellValues.js';

/**
 * Pull the first concrete value for `paramName` out of the tool definition's examples block.
 */
export function findExampleForParam(
	examples: readonly { params: Record<string, unknown> }[] | undefined,
	paramName: string,
): unknown {
	if (!examples) return undefined;
	for (const ex of examples) {
		if (Object.hasOwn(ex.params, paramName) && ex.params[paramName] !== undefined) {
			return ex.params[paramName];
		}
	}
	return undefined;
}

/**
 * Render the tool definition's `examples` block as oclif-flavored example strings.
 * Each entry becomes a single shell-safe invocation line on `FactoryCommand.examples`.
 */
export function buildOclifExamples(def: ToolDefinition, cliCommand: string): string[] {
	if (!def.examples || def.examples.length === 0) return [];
	return def.examples.map((ex) => formatExampleLine(cliCommand, def, ex));
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parameter-type taxonomy
function formatExampleLine(cliCommand: string, def: ToolDefinition, ex: ToolExample): string {
	const parts: string[] = [cliCommand];
	for (const [key, value] of Object.entries(ex.params)) {
		const paramDef = def.parameters[key];
		if (!paramDef || paramDef.gadgetOnly) continue;
		if (value === undefined) continue;

		if (paramDef.type === 'boolean') {
			if (value === true) parts.push(`--${key}`);
			else parts.push(`--no-${key}`);
			continue;
		}
		if (paramDef.type === 'array' && paramDef.items === 'string' && Array.isArray(value)) {
			for (const v of value) parts.push(`--${key} ${formatShellScalar(v)}`);
			continue;
		}
		if (paramDef.type === 'object' || (paramDef.type === 'array' && paramDef.items === 'object')) {
			const json = formatJsonExample(value);
			if (json) parts.push(`--${key} ${json}`);
			continue;
		}
		parts.push(`--${key} ${formatShellScalar(value)}`);
	}
	return parts.join(' ');
}

export { shellQuote };

/**
 * Derive an `expected` shape hint for a JSON-parse failure envelope from the
 * parameter's manifest example (primary source) or its `describe` text (fallback).
 */
export function expectedShapeFor(paramDef: ParameterDefinition, example?: unknown): string {
	if (example !== undefined) {
		return JSON.stringify(example);
	}
	return paramDef.describe;
}

/**
 * MNG-1427: render an `OutputShape` as a plain-text block suitable for
 * appending to an oclif `static description`. The block surfaces in
 * `cascade-tools <group> <command> --help` output beneath the regular
 * description so agents reading help text see the same `success.data`
 * contract as in the system-prompt guidance.
 *
 * The renderer is intentionally minimal — no markdown emphasis, no surrounding
 * blank lines — because oclif word-wraps and indents the description block
 * automatically.
 */
export function renderOutputShapeForHelp(shape: OutputShape): string {
	let block = 'Output shape (success.data):';
	if (shape.summary) {
		block += `\n${shape.summary}`;
	}
	if (shape.fields.length === 0) {
		block += '\n- (shape declared but no fields documented)';
		return block;
	}
	for (const field of shape.fields) {
		block += `\n${formatOutputShapeFieldForHelp(field)}`;
	}
	return block;
}

function formatOutputShapeFieldForHelp(field: OutputShapeField): string {
	const nameSuffix = field.optional ? '?' : '';
	const head = `- ${field.name}${nameSuffix} (${field.type})`;
	return field.description ? `${head} — ${field.description}` : head;
}

/**
 * MNG-1427: assemble the oclif `static description` string by appending the
 * rendered output-shape block (when declared) to the tool's base description.
 * Used by `createCLICommand` so `--help` output picks up the contract without
 * touching the prompt path.
 */
export function buildOclifDescription(def: ToolDefinition): string {
	if (!def.outputShape) return def.description;
	return `${def.description}\n\n${renderOutputShapeForHelp(def.outputShape)}`;
}
