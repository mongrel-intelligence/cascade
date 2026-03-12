/**
 * Factory function for creating oclif CLI Command classes from a ToolDefinition.
 *
 * Given a ToolDefinition and a core async function, this factory generates:
 * - oclif Flags derived from parameter definitions (skipping gadgetOnly params)
 * - File-input alternative flags (--text-file, --body-file, --description-file)
 * - Auto-resolved flags for owner/repo (optional in CLI, resolved from env vars or git remote)
 * - A JSON output command pattern: `this.log(JSON.stringify({ success: true, data: result }))`
 * - An execute() method wired to the coreFn
 */

import { readFileSync } from 'node:fs';

import { Flags } from '@oclif/core';

import { CredentialScopedCommand, resolveOwnerRepo } from '../../cli/base.js';
import type {
	CLIAutoResolved,
	CLIPostExecuteHook,
	FileInputAlternative,
	ParameterDefinition,
	ToolDefinition,
} from './toolDefinition.js';

// biome-ignore lint/suspicious/noExplicitAny: oclif flag generics do not compose safely for dynamic factories
type AnyFlagsRecord = Record<string, any>;
type ParsedFlags = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a single oclif Flag from a ParameterDefinition.
 * Returns undefined if the parameter is gadgetOnly (excluded from CLI).
 */
function buildOclifFlag(
	def: ParameterDefinition,
	isAutoResolved: boolean,
	isFileInputParam: boolean,
	// biome-ignore lint/suspicious/noExplicitAny: dynamic flag factory must accept heterogeneous oclif flag instances
): any {
	// gadgetOnly params (like `comment`) are excluded from CLI flags
	if (def.gadgetOnly) return undefined;

	// File-input params that have a file alternative are optional in the CLI
	// (since the value can come from the file flag instead)
	const isRequired = !isAutoResolved && !isFileInputParam && def.required === true && !def.optional;

	const baseOptions = {
		description: def.describe,
		required: isRequired,
		...(def.cliEnvVar ? { env: def.cliEnvVar } : {}),
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
			return Flags.string({
				...baseOptions,
				multiple: true,
			});
		}
		case 'object': {
			return Flags.string({
				...baseOptions,
				// Object params are passed as JSON string
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
function buildFlagsRecord(def: ToolDefinition): AnyFlagsRecord {
	const flags: AnyFlagsRecord = {};

	const fileInputAlts = def.cli?.fileInputAlternatives ?? [];
	const autoResolved = def.cli?.autoResolved ?? [];

	const fileInputParamNames = new Set(fileInputAlts.map((a) => a.paramName));
	const autoResolvedParamNames = new Set(autoResolved.map((a) => a.paramName));

	// Generate flags for each parameter
	for (const [name, paramDef] of Object.entries(def.parameters)) {
		const isAutoResolved = autoResolvedParamNames.has(name);
		const isFileInputParam = fileInputParamNames.has(name);

		const flag = buildOclifFlag(paramDef, isAutoResolved, isFileInputParam);
		if (flag !== undefined) {
			flags[name] = flag;
		}
	}

	// Add file-input alternative flags
	for (const alt of fileInputAlts) {
		flags[alt.fileFlag] = Flags.string({
			description: alt.description ?? `Read ${alt.paramName} from file (use - for stdin)`,
		});
	}

	return flags;
}

function readFileInput(fileFlagValue: string): string {
	return fileFlagValue === '-' ? readFileSync(0, 'utf-8') : readFileSync(fileFlagValue, 'utf-8');
}

function resolveFileInputParam(
	name: string,
	paramDef: ParameterDefinition,
	fileAlt: FileInputAlternative,
	flags: ParsedFlags,
	command: CredentialScopedCommand,
	resolvedParams: Record<string, unknown>,
): void {
	const fileFlagValue = flags[fileAlt.fileFlag];
	const directValue = flags[name];

	if (typeof fileFlagValue === 'string' && fileFlagValue.length > 0) {
		resolvedParams[name] = readFileInput(fileFlagValue);
		return;
	}

	if (typeof directValue === 'string') {
		resolvedParams[name] = directValue;
		return;
	}

	if (paramDef.required === true) {
		command.error(`Either --${name} or --${fileAlt.fileFlag} is required`);
	}
}

function resolveObjectParam(
	name: string,
	flags: ParsedFlags,
	command: CredentialScopedCommand,
	resolvedParams: Record<string, unknown>,
): void {
	const rawValue = flags[name];
	if (typeof rawValue !== 'string') {
		return;
	}

	try {
		resolvedParams[name] = JSON.parse(rawValue) as unknown;
	} catch {
		command.error(`--${name} must be valid JSON`);
	}
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

function resolveDirectParams(
	def: ToolDefinition,
	flags: ParsedFlags,
	fileInputMap: Map<string, FileInputAlternative>,
	autoResolvedMap: Map<string, CLIAutoResolved>,
	command: CredentialScopedCommand,
): Record<string, unknown> {
	const resolvedParams: Record<string, unknown> = {};

	for (const [name, paramDef] of Object.entries(def.parameters)) {
		if (paramDef.gadgetOnly) continue;

		const autoResolvedConfig = autoResolvedMap.get(name);
		if (autoResolvedConfig?.resolvedFrom === 'git-remote') {
			continue;
		}

		const fileAlt = fileInputMap.get(name);
		if (fileAlt) {
			resolveFileInputParam(name, paramDef, fileAlt, flags, command, resolvedParams);
			continue;
		}

		if (paramDef.type === 'object') {
			resolveObjectParam(name, flags, command, resolvedParams);
			continue;
		}

		resolveStandardParam(name, flags, resolvedParams);
	}

	return resolvedParams;
}

function resolveGitRemoteParams(
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

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Core function signature for CLI commands.
 * Receives the resolved params (after file-input and auto-resolve processing)
 * and returns the result to be JSON-serialized as output.
 */
export type CLICoreFn<
	TParams extends Record<string, unknown> = Record<string, unknown>,
	TResult = unknown,
> = (params: TParams) => Promise<TResult> | TResult;

/**
 * Creates a oclif CLI Command class from a ToolDefinition and a core function.
 *
 * The generated class:
 * - Extends `CredentialScopedCommand`
 * - Has static `description` and `flags` derived from the ToolDefinition
 * - Implements `execute()` which:
 *   1. Parses flags
 *   2. Resolves file-input alternatives (reads file or stdin)
 *   3. Resolves auto-resolved params (owner/repo from env vars or git remote)
 *   4. Validates required params
 *   5. Calls `coreFn` with resolved params
 *   6. Logs JSON output: `{ success: true, data: result }`
 *   7. Calls `cli.postExecute` hook if defined
 *
 * @example
 * ```typescript
 * export default createCLICommand(postCommentDef, async (params) => {
 *   return postComment(params.workItemId, params.text);
 * });
 * ```
 */
export function createCLICommand(
	def: ToolDefinition,
	coreFn: CLICoreFn,
): typeof CredentialScopedCommand {
	const flagsRecord = buildFlagsRecord(def);

	const fileInputAlts: FileInputAlternative[] = def.cli?.fileInputAlternatives ?? [];
	const autoResolvedParams: CLIAutoResolved[] = def.cli?.autoResolved ?? [];
	const postExecuteHook: CLIPostExecuteHook | undefined = def.cli?.postExecute;

	// Create a map of paramName -> autoResolved config for fast lookup
	const autoResolvedMap = new Map<string, CLIAutoResolved>(
		autoResolvedParams.map((a) => [a.paramName, a]),
	);

	// Create a map of paramName -> file flag name for fast lookup
	const fileInputMap = new Map<string, FileInputAlternative>(
		fileInputAlts.map((a) => [a.paramName, a]),
	);

	class FactoryCommand extends CredentialScopedCommand {
		static override description = def.description;
		static override flags = flagsRecord;

		async execute(): Promise<void> {
			const { flags } = await this.parse(FactoryCommand);
			const parsedFlags = flags as ParsedFlags;
			const resolvedParams = resolveDirectParams(
				def,
				parsedFlags,
				fileInputMap,
				autoResolvedMap,
				this,
			);
			resolveGitRemoteParams(autoResolvedParams, parsedFlags, resolvedParams);

			// Call the core function
			const result = await coreFn(resolvedParams);

			// Output JSON result
			this.log(JSON.stringify({ success: true, data: result }));

			// Call post-execute hook if defined
			if (postExecuteHook) {
				await postExecuteHook(result, parsedFlags);
			}
		}
	}

	return FactoryCommand as typeof CredentialScopedCommand;
}
