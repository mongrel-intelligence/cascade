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
import { distance } from 'fastest-levenshtein';

import { CredentialScopedCommand, resolveOwnerRepo } from '../../cli/base.js';
import { type EmitCliErrorOptions, emitCliError } from './errorEnvelope.js';
import type {
	CLIAutoResolved,
	FileInputAlternative,
	ParameterDefinition,
	ToolDefinition,
	ToolExample,
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
 *
 * Branches on parameter type taxonomy (string / number / boolean / enum /
 * array-with-object-items / array-with-string-items / object) — the complexity
 * reflects the domain shape, not tangled logic.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: parameter-type taxonomy
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
			// Primitive arrays (items:'string') stay repeatable (--x a --x b).
			// Object arrays (items:'object') take a single JSON-array string
			// that the factory parses below.
			if (def.items === 'object') {
				return Flags.string({ ...baseOptions });
			}
			return Flags.string({ ...baseOptions, multiple: true });
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

/**
 * Derive an `expected` shape hint for a JSON-parse failure envelope from the
 * parameter's manifest example (primary source) or its `describe` text (fallback).
 */
function expectedShapeFor(paramDef: ParameterDefinition, example?: unknown): string {
	if (example !== undefined) {
		return JSON.stringify(example);
	}
	// No example to lean on — give the agent the describe text so at least
	// the shape hint is non-empty.
	return paramDef.describe;
}

/**
 * JSON-parse a string and emit a structured envelope on failure.
 * Returns the parsed value on success or never-returns on failure (emitCliError exits).
 */
/**
 * Streams/exit delegate the factory hands to {@link emitCliError} so test spies
 * on `instance.log`/`instance.exit` capture the envelope output instead of
 * going directly to process.stdout / process.exit.
 */
interface ErrorSink {
	stdout: NodeJS.WritableStream;
	stderr: NodeJS.WritableStream;
	exit: (code: number) => never;
}

/**
 * Maximum Levenshtein distance between an unknown flag and a declared name
 * before we stop suggesting. Additionally bounded by `MAX_DISTANCE_RATIO`
 * so that very short flags don't pick up wildly different suggestions.
 */
const MAX_FLAG_SUGGESTION_DISTANCE = 2;
const MAX_FLAG_SUGGESTION_RATIO = 0.4;

/**
 * For the given unknown flag and the command's declared flag names + aliases,
 * return the Levenshtein-closest canonical declared name if it passes the
 * distance threshold; otherwise null. Aliases are considered during the match
 * but the returned value is always the canonical flag name.
 */
function suggestFlag(
	unknown: string,
	candidates: { canonical: string; aliases: readonly string[] }[],
): string | null {
	let best: { canonical: string; dist: number } | null = null;
	for (const { canonical, aliases } of candidates) {
		for (const candidate of [canonical, ...aliases]) {
			const d = distance(unknown, candidate);
			if (best === null || d < best.dist) {
				best = { canonical, dist: d };
			}
		}
	}
	if (best === null) return null;
	const target = Math.max(unknown.length, best.canonical.length);
	if (best.dist > MAX_FLAG_SUGGESTION_DISTANCE) return null;
	if (target > 0 && best.dist / target > MAX_FLAG_SUGGESTION_RATIO) return null;
	return best.canonical;
}

/**
 * Collect canonical flag names + their declared aliases from a tool definition.
 * Also includes any file-input alternative flags (which have no canonical counterpart;
 * they stand on their own). Used by fuzzy-suggestion and by help rendering.
 */
function collectCandidateFlags(
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
 * Detect whether an error coming out of `this.parse()` is oclif's
 * `NonExistentFlagsError`. We match by constructor name + the `flags` array
 * shape to stay robust across oclif versions and avoid a deep import.
 */
function isNonexistentFlagError(err: unknown): err is { flags: string[]; message: string } {
	if (!err || typeof err !== 'object') return false;
	const e = err as { name?: string; constructor?: { name?: string }; flags?: unknown };
	const ctorName = e.constructor?.name ?? '';
	const errName = e.name ?? '';
	const looksLikeCLIParse =
		errName === 'CLIParseError' ||
		errName === 'NonExistentFlagsError' ||
		ctorName === 'NonExistentFlagsError';
	return looksLikeCLIParse && Array.isArray(e.flags);
}

/**
 * Spec 014, prod regression 2026-05-09: oclif's parse-time errors (missing
 * required, enum mismatch, unexpected positional from a boolean-value miss)
 * historically threw past the existing unknown-flag catch with `exit code 2`
 * and empty stdout — bypassing the structured envelope contract. Classify the
 * error here so every parse failure reaches the agent through the same shape.
 *
 * Returns a ready-to-emit envelope (omitting only the sink fields). Returns
 * `null` when the error doesn't match any oclif parse-time shape — caller
 * re-throws so unexpected exceptions still surface.
 */
function classifyParseError(
	err: unknown,
): Omit<EmitCliErrorOptions, 'stdout' | 'stderr' | 'exit'> | null {
	if (!err || typeof err !== 'object') return null;
	const e = err as { name?: string; constructor?: { name?: string }; message?: string };
	const ctorName = e.constructor?.name ?? '';
	const message = typeof e.message === 'string' ? e.message : '';

	// FailedFlagValidationError → "Missing required flag <name>"
	if (ctorName === 'FailedFlagValidationError') {
		const m = message.match(/Missing required flag\s+([\w-]+)/);
		if (m) {
			return {
				type: 'missing-required',
				flag: m[1],
				message: `Missing required flag --${m[1]}`,
				hint: `pass --${m[1]} <value> (see --help for the full signature)`,
			};
		}
	}

	// FlagInvalidOptionError → "Expected --<flag>=<value> to be one of: <opts>"
	if (ctorName === 'FlagInvalidOptionError') {
		const m = message.match(/Expected --([\w-]+)=(\S+) to be one of:\s+(.+?)(?:\n|$)/);
		if (m) {
			return {
				type: 'enum-mismatch',
				flag: m[1],
				got: m[2],
				expected: m[3].trim(),
				message: `Flag --${m[1]} got '${m[2]}'; expected one of: ${m[3].trim()}`,
			};
		}
	}

	// UnexpectedArgsError → fallback for boolean-value-form misses that escape
	// the preprocessor (e.g. boolean toggle followed by a non-flag token we
	// chose not to consume because it didn't look bool-shaped).
	if (ctorName === 'UnexpectedArgsError') {
		const m = message.match(/Unexpected argument:\s+(.+?)(?:\n|$)/);
		if (m) {
			return {
				type: 'flag-parse',
				got: m[1].trim(),
				message,
			};
		}
	}

	// Generic CLIParseError fallback (rare).
	if (ctorName.endsWith('Error') && /flag|argument|parse/i.test(message)) {
		return { type: 'flag-parse', message };
	}
	return null;
}

/**
 * Recognised string forms accepted as a value for boolean flags. Codex agents
 * reach for `--includeComments true` (the dominant 2026-05-09 prod failure)
 * even when the synopsis says `--[no-]includeComments`; widen the parser so
 * both shapes work, then keep oclif's strict toggle semantics for everything
 * else. Returns `true` / `false` for recognised values, `null` otherwise so
 * the caller can treat the original token as a non-bool value.
 */
function normalizeBoolValue(raw: string): boolean | null {
	const lc = raw.toLowerCase();
	if (lc === 'true' || lc === 'yes' || lc === '1') return true;
	if (lc === 'false' || lc === 'no' || lc === '0') return false;
	return null;
}

/**
 * Pre-process argv so boolean flags accept the natural value form. Each
 * `--key true|false|...` (space- or equals-separated) is rewritten to oclif's
 * canonical toggle (`--key` or `--no-key`); malformed values surface as a
 * structured `flag-parse` envelope before oclif sees the argv.
 *
 * The preprocessor never consumes a token that LOOKS like another flag
 * (starts with `--`) — that token belongs to a different flag, not to the
 * preceding boolean. Bare-toggle invocations stay untouched.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: argv-shape taxonomy (--key=value, --key value, bare toggle)
function massageBooleanFlagValues(
	argv: readonly string[] | undefined,
	booleanFlags: ReadonlyMap<string, boolean>,
	sink: ErrorSink,
): string[] | undefined {
	// Pass through `undefined` so oclif's `parse(Cmd)` (no argv arg) keeps
	// working — some tests construct commands without seeded argv.
	if (argv === undefined) return undefined;
	if (booleanFlags.size === 0) return [...argv];
	const result: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const tok = argv[i];

		// --flag=value form
		if (tok.startsWith('--') && tok.includes('=')) {
			const eqIdx = tok.indexOf('=');
			const name = tok.slice(2, eqIdx);
			if (booleanFlags.has(name)) {
				const allowNo = booleanFlags.get(name) ?? false;
				const value = tok.slice(eqIdx + 1);
				const normalized = normalizeBoolValue(value);
				if (normalized === true) {
					result.push(`--${name}`);
					continue;
				}
				if (normalized === false) {
					// Only emit --no-<name> when the flag supports negation. For
					// non-negatable booleans (e.g. `draft`), omitting the flag
					// produces the same `false` result without the unknown-flag error.
					if (allowNo) result.push(`--no-${name}`);
					continue;
				}
				emitCliError({
					type: 'flag-parse',
					flag: name,
					message: `Boolean flag --${name} got value '${value}'; accepts true|false|yes|no|1|0`,
					got: value,
					expected: 'true|false|yes|no|1|0',
					hint: allowNo
						? `Use --${name} or --no-${name} for the canonical toggle form, or --${name}=true / --${name}=false.`
						: `Use --${name} for true, or omit the flag for false.`,
					stdout: sink.stdout,
					stderr: sink.stderr,
					exit: sink.exit,
				});
			}
		}

		// --flag <value> form
		if (tok.startsWith('--') && !tok.includes('=')) {
			const name = tok.slice(2);
			if (booleanFlags.has(name) && i + 1 < argv.length) {
				const allowNo = booleanFlags.get(name) ?? false;
				const next = argv[i + 1];
				const normalized = normalizeBoolValue(next);
				if (normalized === true) {
					result.push(`--${name}`);
					i++;
					continue;
				}
				if (normalized === false) {
					// Only emit --no-<name> when the flag supports negation. For
					// non-negatable booleans, just consume the token — absence = false.
					if (allowNo) result.push(`--no-${name}`);
					i++;
					continue;
				}
				// Next token is something else. If it doesn't start with `--`, the
				// agent meant it as a value to this boolean — surface a precise
				// envelope here so we don't bottom out as `Unexpected argument`.
				if (!next.startsWith('--')) {
					emitCliError({
						type: 'flag-parse',
						flag: name,
						message: `Boolean flag --${name} got value '${next}'; accepts true|false|yes|no|1|0`,
						got: next,
						expected: 'true|false|yes|no|1|0',
						hint: allowNo
							? `Use --${name} or --no-${name} for the canonical toggle form.`
							: `Use --${name} for true, or omit the flag for false.`,
						stdout: sink.stdout,
						stderr: sink.stderr,
						exit: sink.exit,
					});
				}
				// next is another flag — leave the bare toggle as-is.
			}
		}
		result.push(tok);
	}
	return result;
}

/**
 * Collect boolean flag metadata for the argv preprocessor.
 *
 * Returns a Map from flag name to whether it supports `--no-<name>` negation
 * (`allowNo`). The preprocessor uses this to decide:
 * - `true` value  → always rewrite to `--<name>`
 * - `false` value → `--no-<name>` only when allowNo is set; otherwise drop the
 *                   token (absence = false for non-negatable booleans, so this
 *                   produces the correct oclif parse result without emitting an
 *                   unknown flag). Fixes `--draft false` on `scm create-pr`.
 */
function collectBooleanFlagNames(def: ToolDefinition): Map<string, boolean> {
	const flags = new Map<string, boolean>();
	for (const [name, paramDef] of Object.entries(def.parameters)) {
		if (paramDef.gadgetOnly) continue;
		if (paramDef.type === 'boolean') {
			flags.set(name, paramDef.allowNo ?? false);
		}
	}
	return flags;
}

/**
 * Build an error sink bound to a CredentialScopedCommand instance, so that
 * emitCliError routes envelope output through `instance.log` (stripping the
 * trailing newline oclif's `this.log` adds itself) and `instance.exit`. This
 * keeps test spies honest.
 *
 * Note on stderr: Command instances don't expose a `stderr` method publicly,
 * but tests don't assert on stderr from the factory surface (they assert on
 * the prose summary via the errorEnvelope unit tests). Here we write directly
 * to `process.stderr`.
 */
function buildSink(command: CredentialScopedCommand): ErrorSink {
	const stdout: NodeJS.WritableStream = {
		write: (chunk: string | Uint8Array): boolean => {
			const text = typeof chunk === 'string' ? chunk : String(chunk);
			// Some tests construct commands without a log spy installed; fall back
			// to a no-op so envelope emission can't crash the test setup.
			if (typeof command.log === 'function') {
				command.log(text.replace(/\n$/, ''));
			}
			return true;
		},
	} as NodeJS.WritableStream;
	const exit =
		typeof command.exit === 'function'
			? (command.exit.bind(command) as (code: number) => never)
			: (process.exit as (code: number) => never);
	return { stdout, stderr: process.stderr, exit };
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

	// Direct (non-file) value: for array-of-object we still need to JSON-parse;
	// for primitive string params we pass through.
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

/**
 * Resolve a `type:'array', items:'object'` flag value: JSON-parse the single
 * string form. oclif gives us a bare string because we set `multiple:false`
 * for items:'object' in buildOclifFlag.
 */
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

function resolveDirectParams(
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

		// Derive one concrete example value per parameter from def.examples, used
		// by JSON-parse error messages to show the agent the expected shape.
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

/**
 * Pull the first concrete value for `paramName` out of the tool definition's
 * examples block. Mirrors the manifest generator's `findExampleForParam` but
 * kept local to avoid a cross-import cycle with the manifest module.
 */
function findExampleForParam(
	examples: readonly ToolExample[] | undefined,
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
function buildOclifExamples(def: ToolDefinition, cliCommand: string): string[] {
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

function shellQuote(s: string): string {
	// Wrap with single quotes; escape any embedded single quote with the
	// classic '\'' trick so copy/paste into a POSIX shell remains safe.
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Derive the `cascade-tools <category> <command>` prefix for a tool, matching
 * {@link ../shared/manifestGenerator.ts#deriveCLICommand}. Duplicated locally to
 * avoid a cross-import cycle.
 */
function deriveCommandPrefix(toolName: string): string {
	// Minimal duplicate of deriveCLICommand — enough to seed oclif examples.
	if (toolName === 'Finish') {
		return `cascade-tools session ${kebab(toolName)}`;
	}
	if (
		toolName.startsWith('CreatePR') ||
		toolName.startsWith('GetPR') ||
		toolName.startsWith('PostPR') ||
		toolName.startsWith('UpdatePR') ||
		toolName.startsWith('ReplyTo') ||
		toolName === 'GetCIRunLogs'
	) {
		return `cascade-tools scm ${kebab(toolName)}`;
	}
	let commandName = toolName;
	if (toolName.startsWith('PM') && toolName.length > 2 && /[A-Z]/.test(toolName[2])) {
		commandName = toolName.slice(2);
	}
	return `cascade-tools pm ${kebab(commandName)}`;
}

function kebab(name: string): string {
	return name
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
		.replace(/([a-z\d])([A-Z])/g, '$1-$2')
		.toLowerCase();
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

	const commandPrefix = deriveCommandPrefix(def.name);
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
