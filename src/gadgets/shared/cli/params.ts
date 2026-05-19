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

/**
 * Spec MNG-1059: stdin (fd 0) can only be drained once per process. When a
 * cascade-tools call passes `-` as the path for two or more file-input flags
 * (e.g. `--body-file - --comments-file -`), the first `readFileSync(0, ...)`
 * consumes every byte of stdin and the second consumer reads an empty string —
 * silently truncating one of the agent's payloads. Detect that combination
 * before any read occurs and emit a structured `flag-parse` envelope the agent
 * can self-correct from on the next attempt.
 *
 * Returns `never` (via `emitCliError`) when two or more file-input flags are
 * set to `-`; returns normally when at most one is.
 */
export function rejectMultipleStdinConsumers(
	fileInputAlts: readonly FileInputAlternative[],
	flags: ParsedFlags,
	sink: ErrorSink,
): void {
	const stdinFlags = fileInputAlts
		.map((a) => a.fileFlag)
		.filter((fileFlag) => flags[fileFlag] === '-');

	if (stdinFlags.length < 2) return;

	emitCliError({
		type: 'flag-parse',
		flag: stdinFlags.join(','),
		message: `Multiple file-input flags read from stdin: ${stdinFlags
			.map((f) => `--${f} -`)
			.join(' and ')}. stdin can only be drained once per process.`,
		hint: `Pass at most one --*-file -; for the others, write the payload to a temp file and pass --<flag>-file <path>.`,
		stdout: sink.stdout,
		stderr: sink.stderr,
		exit: sink.exit,
	});
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

function describeJsonTopLevel(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}

function normalizeArrayOfObjectJsonOrError(
	parsed: unknown,
	flag: string,
	paramDef: ParameterDefinition,
	fileAlt: FileInputAlternative | undefined,
	example: unknown,
	sink: ErrorSink,
): unknown {
	if (paramDef.type !== 'array' || paramDef.items !== 'object') {
		return parsed;
	}

	if (Array.isArray(parsed)) {
		return parsed;
	}

	if (parsed !== null && typeof parsed === 'object') {
		return [parsed];
	}

	const fileHint = fileAlt ? ` Or pass --${fileAlt.fileFlag} <path> (or - for stdin).` : '';
	return emitCliError({
		type: 'json-parse',
		flag,
		message: `Expected JSON array or object, got ${describeJsonTopLevel(parsed)}`,
		got: JSON.stringify(parsed),
		expected: expectedShapeFor(paramDef, example),
		hint: `Pass a JSON array of objects or one JSON object to normalize into a single-item array.${fileHint}`,
		stdout: sink.stdout,
		stderr: sink.stderr,
		exit: sink.exit,
	});
}

function parseJsonParamOrError(
	raw: string,
	flag: string,
	paramDef: ParameterDefinition,
	fileAlt: FileInputAlternative | undefined,
	example: unknown,
	sink: ErrorSink,
): unknown {
	const parsed = parseJsonOrError(raw, flag, paramDef, fileAlt, example, sink);
	return normalizeArrayOfObjectJsonOrError(parsed, flag, paramDef, fileAlt, example, sink);
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
			resolvedParams[name] = parseJsonParamOrError(
				contents,
				name,
				paramDef,
				fileAlt,
				example,
				sink,
			);
			return;
		}
		resolvedParams[name] = contents;
		return;
	}

	if (directValue !== undefined && directValue !== null) {
		if (paramDef.type === 'array' && paramDef.items === 'object') {
			const asString = typeof directValue === 'string' ? directValue : JSON.stringify(directValue);
			resolvedParams[name] = parseJsonParamOrError(
				asString,
				name,
				paramDef,
				fileAlt,
				example,
				sink,
			);
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
	resolvedParams[name] = parseJsonParamOrError(rawValue, name, paramDef, undefined, example, sink);
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
	resolvedParams[name] = parseJsonParamOrError(asString, name, paramDef, fileAlt, example, sink);
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
