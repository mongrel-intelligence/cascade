import { readFileSync } from 'node:fs';

import { resolveOwnerRepo } from '../../../cli/base.js';
import { emitCliError } from '../errorEnvelope.js';
import type {
	CLIAutoResolved,
	FileInputAlternative,
	ParameterDefinition,
	ToolDefinition,
} from '../toolDefinition.js';
import type { ErrorSink } from './errorSink.js';
import { expectedShapeFor, findExampleForParam } from './examples.js';
import type { ParsedFlags } from './types.js';

function readFileInput(fileFlagValue: string): string {
	return fileFlagValue === '-' ? readFileSync(0, 'utf-8') : readFileSync(fileFlagValue, 'utf-8');
}

function parseJsonOrError(
	raw: string,
	flag: string,
	paramDef: ParameterDefinition,
	fileAlt: FileInputAlternative | undefined,
	example: unknown,
	sink: ErrorSink,
): unknown {
	try {
		return JSON.parse(raw);
	} catch (err) {
		const hint = fileAlt
			? `Use double-quoted JSON keys and values. For long payloads pass --${fileAlt.fileFlag} <path> (or - for stdin).`
			: 'Use double-quoted JSON keys and values.';
		return emitCliError({
			type: 'json-parse',
			flag,
			message: err instanceof Error ? err.message : String(err),
			got: raw,
			expected: expectedShapeFor(paramDef, example),
			hint,
			stdout: sink.stdout,
			stderr: sink.stderr,
			exit: sink.exit,
		});
	}
}

function resolveFileInputParam(
	name: string,
	paramDef: ParameterDefinition,
	fileAlt: FileInputAlternative,
	flags: ParsedFlags,
	resolvedParams: Record<string, unknown>,
	example: unknown,
	sink: ErrorSink,
): void {
	const fileFlagValue = flags[fileAlt.fileFlag];
	const directValue = flags[name];

	if (typeof fileFlagValue === 'string' && fileFlagValue.length > 0) {
		const contents = readFileInput(fileFlagValue);
		if (fileAlt.parseAs === 'json') {
			resolvedParams[name] = parseJsonOrError(contents, name, paramDef, fileAlt, example, sink);
			return;
		}
		resolvedParams[name] = contents;
		return;
	}

	if (directValue !== undefined && directValue !== null) {
		if (paramDef.type === 'array' && paramDef.items === 'object') {
			const asString = typeof directValue === 'string' ? directValue : JSON.stringify(directValue);
			resolvedParams[name] = parseJsonOrError(asString, name, paramDef, fileAlt, example, sink);
			return;
		}
		if (typeof directValue === 'string') {
			resolvedParams[name] = directValue;
			return;
		}
	}

	if (paramDef.required === true) {
		emitCliError({
			type: 'missing-required',
			flag: name,
			message: `Either --${name} or --${fileAlt.fileFlag} is required`,
			hint: `Pass --${name} '<value>' or --${fileAlt.fileFlag} <path> (use - for stdin).`,
			stdout: sink.stdout,
			stderr: sink.stderr,
			exit: sink.exit,
		});
	}
}

function resolveObjectParam(
	name: string,
	flags: ParsedFlags,
	resolvedParams: Record<string, unknown>,
	paramDef: ParameterDefinition,
	example: unknown,
	sink: ErrorSink,
): void {
	const rawValue = flags[name];
	if (typeof rawValue !== 'string') {
		return;
	}
	resolvedParams[name] = parseJsonOrError(rawValue, name, paramDef, undefined, example, sink);
}

function resolveArrayOfObjectParam(
	name: string,
	flags: ParsedFlags,
	resolvedParams: Record<string, unknown>,
	paramDef: ParameterDefinition,
	fileAlt: FileInputAlternative | undefined,
	example: unknown,
	sink: ErrorSink,
): void {
	const rawValue = flags[name];
	if (rawValue === undefined) return;
	const asString = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);
	resolvedParams[name] = parseJsonOrError(asString, name, paramDef, fileAlt, example, sink);
}

function resolveStandardParam(
	name: string,
	flags: ParsedFlags,
	resolvedParams: Record<string, unknown>,
): void {
	const value = flags[name];
	if (value !== undefined) {
		resolvedParams[name] = value;
	}
}

export function resolveDirectParams(
	def: ToolDefinition,
	flags: ParsedFlags,
	fileInputMap: Map<string, FileInputAlternative>,
	autoResolvedMap: Map<string, CLIAutoResolved>,
	sink: ErrorSink,
): Record<string, unknown> {
	const resolvedParams: Record<string, unknown> = {};

	for (const [name, paramDef] of Object.entries(def.parameters)) {
		if (paramDef.gadgetOnly) continue;

		const autoResolvedConfig = autoResolvedMap.get(name);
		if (autoResolvedConfig?.resolvedFrom === 'git-remote') {
			continue;
		}

		const example = findExampleForParam(def.examples, name);
		const fileAlt = fileInputMap.get(name);
		if (fileAlt) {
			resolveFileInputParam(name, paramDef, fileAlt, flags, resolvedParams, example, sink);
			continue;
		}

		if (paramDef.type === 'object') {
			resolveObjectParam(name, flags, resolvedParams, paramDef, example, sink);
			continue;
		}

		if (paramDef.type === 'array' && paramDef.items === 'object') {
			resolveArrayOfObjectParam(name, flags, resolvedParams, paramDef, undefined, example, sink);
			continue;
		}

		resolveStandardParam(name, flags, resolvedParams);
	}

	return resolvedParams;
}

export function resolveGitRemoteParams(
	autoResolvedParams: CLIAutoResolved[],
	flags: ParsedFlags,
	resolvedParams: Record<string, unknown>,
): void {
	const gitRemoteParams = autoResolvedParams.filter((a) => a.resolvedFrom === 'git-remote');
	if (gitRemoteParams.length === 0) return;

	const ownerConfig = gitRemoteParams.find(
		(a) => a.paramName === 'owner' || a.envVar?.includes('OWNER'),
	);
	const repoConfig = gitRemoteParams.find(
		(a) => a.paramName === 'repo' || a.envVar?.includes('NAME'),
	);

	if (!ownerConfig && !repoConfig) return;

	const ownerFlag =
		ownerConfig && typeof flags[ownerConfig.paramName] === 'string'
			? (flags[ownerConfig.paramName] as string)
			: undefined;
	const repoFlag =
		repoConfig && typeof flags[repoConfig.paramName] === 'string'
			? (flags[repoConfig.paramName] as string)
			: undefined;
	const { owner, repo } = resolveOwnerRepo(ownerFlag, repoFlag);

	if (ownerConfig) resolvedParams[ownerConfig.paramName] = owner;
	if (repoConfig) resolvedParams[repoConfig.paramName] = repo;
}
