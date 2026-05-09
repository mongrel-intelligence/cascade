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

import { CredentialScopedCommand } from '../../cli/base.js';
import { massageBooleanFlagValues } from './cli/booleanArgv.js';
import { deriveCLICommand } from './cli/commandNames.js';
import { buildSink } from './cli/errorSink.js';
import { buildOclifExamples } from './cli/examples.js';
import { buildFlagsRecord, collectBooleanFlagNames, collectCandidateFlags } from './cli/flags.js';
import { resolveDirectParams, resolveGitRemoteParams } from './cli/params.js';
import { classifyParseError, isNonexistentFlagError, suggestFlag } from './cli/parseErrors.js';
import type { ParsedFlags } from './cli/types.js';
import { emitCliError } from './errorEnvelope.js';
import type { CLIAutoResolved, FileInputAlternative, ToolDefinition } from './toolDefinition.js';

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

	// Create a map of paramName -> autoResolved config for fast lookup
	const autoResolvedMap = new Map<string, CLIAutoResolved>(
		autoResolvedParams.map((a) => [a.paramName, a]),
	);

	// Create a map of paramName -> file flag name for fast lookup
	const fileInputMap = new Map<string, FileInputAlternative>(
		fileInputAlts.map((a) => [a.paramName, a]),
	);

	const commandPrefix = deriveCLICommand(def.name);
	const staticExamples = buildOclifExamples(def, commandPrefix);
	const booleanFlagNames = collectBooleanFlagNames(def);

	class FactoryCommand extends CredentialScopedCommand {
		static override description = def.description;
		static override flags = flagsRecord;
		static override examples = staticExamples;

		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parse-error classification taxonomy (unknown-flag / classified / runtime / re-throw)
		async execute(): Promise<void> {
			// Build a sink that routes emitCliError output through the instance's
			// log/exit — lets tests spy on instance.log and instance.exit.
			const sink = buildSink(this);

			// Pre-process argv so boolean flags accept the natural value form
			// (`--key true|false|yes|no|1|0`). Reshapes to oclif's canonical
			// toggle (`--key` / `--no-key`) before parsing; emits a structured
			// flag-parse envelope inline for malformed bool values.
			const massagedArgv = massageBooleanFlagValues(this.argv, booleanFlagNames, sink);

			let flags: unknown;
			try {
				({ flags } = await this.parse(FactoryCommand, massagedArgv));
			} catch (err) {
				if (isNonexistentFlagError(err)) {
					const candidates = collectCandidateFlags(def);
					const offending = err.flags[0] ?? '';
					const suggestion = suggestFlag(offending, candidates);
					emitCliError({
						type: 'unknown-flag',
						flag: offending,
						message: err.message,
						...(suggestion ? { hint: `did you mean --${suggestion}?` } : {}),
						stdout: sink.stdout,
						stderr: sink.stderr,
						exit: sink.exit,
					});
					return;
				}
				const classified = classifyParseError(err);
				if (classified) {
					emitCliError({
						...classified,
						stdout: sink.stdout,
						stderr: sink.stderr,
						exit: sink.exit,
					});
					return;
				}
				throw err;
			}
			const parsedFlags = flags as ParsedFlags;
			const resolvedParams = resolveDirectParams(
				def,
				parsedFlags,
				fileInputMap,
				autoResolvedMap,
				sink,
			);
			resolveGitRemoteParams(autoResolvedParams, parsedFlags, resolvedParams);

			// Call the core function — wrap runtime failures in the spec-014 envelope.
			let result: unknown;
			try {
				result = await coreFn(resolvedParams);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				emitCliError({
					type: 'runtime',
					message,
					stdout: sink.stdout,
					stderr: sink.stderr,
					exit: sink.exit,
				});
				return;
			}

			// Output JSON result
			this.log(JSON.stringify({ success: true, data: result }));
		}
	}

	return FactoryCommand as typeof CredentialScopedCommand;
}
