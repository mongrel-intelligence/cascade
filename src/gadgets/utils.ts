/**
 * Formats an error for gadget responses.
 * @param action - Description of what failed (e.g., "adding checklist", "fetching PR details")
 * @param error - The caught error
 * @returns Formatted error string
 */
export function formatGadgetError(action: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `Error ${action}: ${message}`;
}
