import type { ParameterDefinition, ToolDefinition, ToolExample } from '../toolDefinition.js';

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
			for (const v of value) parts.push(`--${key} ${shellQuote(String(v))}`);
			continue;
		}
		if (paramDef.type === 'object' || (paramDef.type === 'array' && paramDef.items === 'object')) {
			parts.push(`--${key} ${shellQuote(JSON.stringify(value))}`);
			continue;
		}
		parts.push(`--${key} ${shellQuote(String(value))}`);
	}
	return parts.join(' ');
}

export function shellQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

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
