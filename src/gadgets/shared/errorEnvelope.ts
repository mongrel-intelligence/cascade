/**
 * Shared cascade-tools CLI error envelope (spec 014).
 *
 * Every cascade-tools failure — flag-parse, JSON-parse, missing-required,
 * enum-mismatch, unknown-flag, auth, runtime — emits through {@link emitCliError}:
 *
 * - Structured JSON on stdout: `{"success":false,"error":<envelope>}` so agents
 *   parsing CLI output see one stable surface.
 * - One-line prose summary on stderr so humans running the command in a terminal
 *   get a readable error without piping through `jq`.
 * - Exit code 1.
 *
 * The envelope shape is part of the cascade-tools contract. Renaming fields is
 * a breaking change — agents rely on `error.type` / `error.flag` / `error.hint`
 * to self-correct on the next attempt.
 */

/**
 * Classification of a cascade-tools failure. Agents may branch on this.
 */
export type CliErrorType =
	| 'flag-parse'
	| 'json-parse'
	| 'missing-required'
	| 'enum-mismatch'
	| 'unknown-flag'
	| 'auth'
	| 'runtime';

/**
 * The stable envelope shape emitted by {@link emitCliError}. New fields may be
 * added over time; existing field names are load-bearing.
 */
export interface CliErrorEnvelope {
	/** Classification the agent may branch on */
	type: CliErrorType;
	/** Flag name associated with the failure (when applicable) */
	flag?: string;
	/** Human-readable message describing the failure */
	message: string;
	/** Truncated view of the offending input, when relevant */
	got?: string;
	/** A shape fragment describing what was expected, when relevant */
	expected?: string;
	/** A hint the agent can act on (e.g. "did you mean --comments?") */
	hint?: string;
	/** A runnable example the agent can adapt, when the tool definition has one */
	example?: string;
}

/**
 * Options accepted by {@link emitCliError}. Extends the envelope with optional
 * stream + exit injection for testability.
 */
export interface EmitCliErrorOptions extends CliErrorEnvelope {
	stdout?: NodeJS.WritableStream;
	stderr?: NodeJS.WritableStream;
	exit?: (code: number) => never;
}

const DEFAULT_GOT_TRUNCATE = 80;

/**
 * Truncate a long user input to `max` characters, appending `...` when cut.
 * Exported for unit tests; internal callers use it directly.
 */
export function truncateGot(input: string, max = DEFAULT_GOT_TRUNCATE): string {
	if (input.length <= max) return input;
	return `${input.slice(0, max)}...`;
}

/**
 * Build the one-line prose summary written to stderr.
 *
 * Format: `--<flag>: <type> — <message>` (omits the flag clause when absent).
 * Trimmed to {@link max} characters to keep the stderr surface glanceable.
 */
function buildProseSummary(env: CliErrorEnvelope, max = 120): string {
	const flagPart = env.flag ? `--${env.flag}: ` : '';
	const line = `${flagPart}${env.type} — ${env.message}`.replace(/\s+/g, ' ').trim();
	return line.length <= max ? line : `${line.slice(0, max - 3)}...`;
}

/**
 * Emit a cascade-tools error envelope and terminate the process.
 *
 * - Writes `{"success":false,"error":<envelope>}\n` to stdout.
 * - Writes a short prose summary to stderr.
 * - Exits with code 1.
 *
 * Callers MUST treat this as a non-returning function. The default `exit`
 * delegate is `process.exit`; tests inject a throwing stub to verify the call.
 */
export function emitCliError(opts: EmitCliErrorOptions): never {
	const stdout = opts.stdout ?? process.stdout;
	const stderr = opts.stderr ?? process.stderr;
	const exit = opts.exit ?? (process.exit as (code: number) => never);

	const envelope: CliErrorEnvelope = {
		type: opts.type,
		message: opts.message,
	};
	if (opts.flag !== undefined) envelope.flag = opts.flag;
	if (opts.got !== undefined) envelope.got = truncateGot(opts.got);
	if (opts.expected !== undefined) envelope.expected = opts.expected;
	if (opts.hint !== undefined) envelope.hint = opts.hint;
	if (opts.example !== undefined) envelope.example = opts.example;

	stdout.write(`${JSON.stringify({ success: false, error: envelope })}\n`);
	stderr.write(`${buildProseSummary(envelope)}\n`);

	return exit(1);
}
