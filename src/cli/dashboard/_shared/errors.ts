import { TRPCClientError } from '@trpc/client';

/**
 * Actionable error information with user-facing message and suggestion.
 */
export interface ActionableError {
	/** Short message describing what went wrong */
	message: string;
	/** Suggestion on how to fix it */
	suggestion?: string;
}

/**
 * Maps a TRPCClientError to an actionable error with a helpful suggestion.
 *
 * @param err - The error to map
 * @param serverUrl - The server URL (used in connection error messages)
 * @returns An ActionableError with message and optional suggestion
 */
export function mapTRPCError(err: TRPCClientError<never>, _serverUrl?: string): ActionableError {
	const code = (err.data as { code?: string } | undefined)?.code;

	switch (code) {
		case 'UNAUTHORIZED':
			return {
				message: 'Authentication required.',
				suggestion: "Run 'cascade login' to authenticate.",
			};

		case 'FORBIDDEN':
			return {
				message: 'Access denied.',
				suggestion: 'You do not have permission to perform this action.',
			};

		case 'NOT_FOUND':
			return {
				message: err.message,
				suggestion: "Try 'cascade <resource> list' to see available IDs.",
			};

		case 'BAD_REQUEST': {
			// Extract validation details from the error message if available
			const details = err.message;
			return {
				message: `Invalid request: ${details}`,
				suggestion: 'Check the command arguments and try again.',
			};
		}

		default:
			return {
				message: err.message,
			};
	}
}

/**
 * Checks if an error is a network connectivity error (ECONNREFUSED, ENOTFOUND, fetch failures).
 *
 * @param err - The error to check
 * @returns true if the error is a network error
 */
export function isNetworkError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;

	// Check error message patterns for connection refused / DNS failures
	const msg = err.message.toLowerCase();
	if (msg.includes('econnrefused') || msg.includes('enotfound')) return true;

	// Check underlying cause
	const cause = (err as NodeJS.ErrnoException).cause;
	if (cause instanceof Error) {
		const causeMsg = cause.message.toLowerCase();
		if (causeMsg.includes('econnrefused') || causeMsg.includes('enotfound')) return true;
	}

	// Check error code directly
	const code = (err as NodeJS.ErrnoException).code;
	if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') return true;

	return false;
}

/**
 * Maps any error to an actionable error with a helpful message and suggestion.
 *
 * @param err - The error to map
 * @param serverUrl - The server URL (used in connection error messages)
 * @returns An ActionableError with message and optional suggestion
 */
export function mapError(err: unknown, serverUrl?: string): ActionableError {
	if (err instanceof TRPCClientError) {
		// Check if the underlying cause is a network error
		if (isNetworkError(err.cause ?? err)) {
			const urlPart = serverUrl ? ` at ${serverUrl}` : '';
			return {
				message: `Cannot reach server${urlPart}.`,
				suggestion: 'Is the dashboard running? Check your server URL with `cascade whoami`.',
			};
		}
		return mapTRPCError(err as TRPCClientError<never>, serverUrl);
	}

	if (isNetworkError(err)) {
		const urlPart = serverUrl ? ` at ${serverUrl}` : '';
		return {
			message: `Cannot reach server${urlPart}.`,
			suggestion: 'Is the dashboard running? Check your server URL with `cascade whoami`.',
		};
	}

	if (err instanceof Error) {
		return { message: err.message };
	}

	return { message: String(err) };
}

/**
 * Formats an actionable error into a display string.
 *
 * @param err - The actionable error to format
 * @returns Formatted string (message + suggestion on new line if present)
 */
export function formatActionableError(err: ActionableError): string {
	if (err.suggestion) {
		return `${err.message}\n  ${err.suggestion}`;
	}
	return err.message;
}
