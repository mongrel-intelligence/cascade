/**
 * Typed error boundary for failures that occur in the worker BEFORE agent
 * execution starts (template load, model resolution, gadget-allowlist
 * resolution, context-pipeline assembly, identifier resolution).
 *
 * Per spec 018:
 * - Worker exits with code 2 when this error escapes (vs 0 for success/no-op
 *   and 1 for in-execution crash).
 * - The error is captured to Sentry under the stable tag `worker_boot_failure`.
 * - The run row, created upfront before any boot-phase step, is marked failed
 *   with a structured error message before re-throwing.
 *
 * The phase tag lets observers know WHICH boot step failed.
 */

export type BootPhase =
	| 'run-record'
	| 'template-load'
	| 'model-resolution'
	| 'plan-resolution'
	| 'gadget-allowlist'
	| 'context-pipeline'
	| 'definition-lookup'
	| 'identifier'
	| 'identifier-resolution'
	| 'unknown';

function formatBootFailureMessage(message: string, cause: unknown): string {
	if (cause instanceof Error && cause.message) {
		return `${message}: ${cause.message}`;
	}
	if (cause !== undefined && cause !== null) {
		return `${message}: ${String(cause)}`;
	}
	return message;
}

export class BootFailureError extends Error {
	readonly phase: BootPhase;
	readonly cause?: unknown;

	constructor(message: string, opts: { phase: BootPhase; cause?: unknown }) {
		super(formatBootFailureMessage(message, opts.cause));
		this.name = 'BootFailureError';
		this.phase = opts.phase;
		this.cause = opts.cause;

		if (opts.cause instanceof Error && opts.cause.stack) {
			this.stack = `${this.stack}\nCaused by: ${opts.cause.stack}`;
		}
	}
}
