import type { CredentialScopedCommand } from '../../../cli/base.js';

/**
 * Streams/exit delegate the factory hands to emitCliError so test spies on
 * `instance.log`/`instance.exit` capture the envelope output.
 */
export interface ErrorSink {
	stdout: NodeJS.WritableStream;
	stderr: NodeJS.WritableStream;
	exit: (code: number) => never;
}

/**
 * Build an error sink bound to a CredentialScopedCommand instance.
 */
export function buildSink(command: CredentialScopedCommand): ErrorSink {
	const stdout: NodeJS.WritableStream = {
		write: (chunk: string | Uint8Array): boolean => {
			const text = typeof chunk === 'string' ? chunk : String(chunk);
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
