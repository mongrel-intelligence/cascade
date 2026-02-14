/**
 * Shared output formatting for cascade-tools CLI commands.
 * All commands output JSON to stdout, errors as JSON to stderr.
 */

export function formatSuccess(data: unknown): string {
	return JSON.stringify({ success: true, data }, null, 2);
}

export function formatError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return JSON.stringify({ success: false, error: message }, null, 2);
}
