import { Flags } from '@oclif/core';

import type { ParameterDefinition, ToolDefinition } from '../toolDefinition.js';
import type { AnyFlagsRecord } from './types.js';

/**
 * Build a single oclif Flag from a ParameterDefinition.
 * Returns undefined if the parameter is gadgetOnly (excluded from CLI).
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parameter-type taxonomy
export function buildOclifFlag(
	def: ParameterDefinition,
	isAutoResolved: boolean,
	isFileInputParam: boolean,
	// biome-ignore lint/suspicious/noExplicitAny: dynamic flag factory must accept heterogeneous oclif flag instances
): any {
	if (def.gadgetOnly) return undefined;

	const isRequired = !isAutoResolved && !isFileInputParam && def.required === true && !def.optional;

	const baseOptions = {
		description: def.describe,
		required: isRequired,
		...(def.cliEnvVar ? { env: def.cliEnvVar } : {}),
		...(def.cliAliases && def.cliAliases.length > 0 ? { aliases: [...def.cliAliases] } : {}),
	};

	switch (def.type) {
		case 'string': {
			return Flags.string({
				...baseOptions,
				...(def.default !== undefined ? { default: def.default } : {}),
			});
		}
		case 'number': {
			return Flags.integer({
				...baseOptions,
				...(def.default !== undefined ? { default: def.default } : {}),
			});
		}
		case 'boolean': {
			return Flags.boolean({
				...baseOptions,
				...(def.default !== undefined ? { default: def.default } : {}),
				...('allowNo' in def && def.allowNo ? { allowNo: true } : {}),
			});
		}
		case 'enum': {
			return Flags.string({
				...baseOptions,
				options: [...def.options],
				...(def.default !== undefined ? { default: def.default } : {}),
			});
		}
		case 'array': {
			if (def.items === 'object') {
				return Flags.string({ ...baseOptions });
			}
			return Flags.string({ ...baseOptions, multiple: true });
		}
		case 'object': {
			return Flags.string({
				...baseOptions,
			});
		}
		default: {
			const _exhaustive: never = def;
			throw new Error(`Unknown parameter type: ${(_exhaustive as ParameterDefinition).type}`);
		}
	}
}

/**
 * Build the complete oclif flags record from a ToolDefinition.
 * Includes file-input alternative flags and auto-resolved flags.
 */
export function buildFlagsRecord(def: ToolDefinition): AnyFlagsRecord {
	const flags: AnyFlagsRecord = {};

	const fileInputAlts = def.cli?.fileInputAlternatives ?? [];
	const autoResolved = def.cli?.autoResolved ?? [];

	const fileInputParamNames = new Set(fileInputAlts.map((a) => a.paramName));
	const autoResolvedParamNames = new Set(autoResolved.map((a) => a.paramName));

	for (const [name, paramDef] of Object.entries(def.parameters)) {
		const isAutoResolved = autoResolvedParamNames.has(name);
		const isFileInputParam = fileInputParamNames.has(name);

		const flag = buildOclifFlag(paramDef, isAutoResolved, isFileInputParam);
		if (flag !== undefined) {
			flags[name] = flag;
		}
	}

	for (const alt of fileInputAlts) {
		flags[alt.fileFlag] = Flags.string({
			description: alt.description ?? `Read ${alt.paramName} from file (use - for stdin)`,
		});
	}

	return flags;
}

/**
 * Collect canonical flag names + their declared aliases from a tool definition.
 */
export function collectCandidateFlags(
	def: ToolDefinition,
): { canonical: string; aliases: readonly string[] }[] {
	const list: { canonical: string; aliases: readonly string[] }[] = [];
	for (const [name, paramDef] of Object.entries(def.parameters)) {
		if (paramDef.gadgetOnly) continue;
		list.push({ canonical: name, aliases: paramDef.cliAliases ?? [] });
	}
	for (const alt of def.cli?.fileInputAlternatives ?? []) {
		list.push({ canonical: alt.fileFlag, aliases: [] });
	}
	return list;
}

/**
 * Collect boolean flag metadata for the argv preprocessor.
 */
export function collectBooleanFlagNames(def: ToolDefinition): Map<string, boolean> {
	const flags = new Map<string, boolean>();
	for (const [name, paramDef] of Object.entries(def.parameters)) {
		if (paramDef.gadgetOnly) continue;
		if (paramDef.type === 'boolean') {
			flags.set(name, paramDef.allowNo ?? false);
		}
	}
	return flags;
}
