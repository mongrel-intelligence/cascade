/**
 * Error thrown when a command exits with non-zero exit code.
 * Contains session name, exit code, and output preview for debugging.
 */
export class CommandFailedError extends Error {
	constructor(
		public readonly session: string,
		public readonly exitCode: number,
		public readonly output: string,
	) {
		const preview = output.length > 1000 ? output.slice(-1000) : output;
		super(
			`Command exited with code ${exitCode}\n\n` +
				`Session: ${session}\n` +
				`Exit code: ${exitCode}\n\n` +
				`Output:\n${preview || '(no output)'}`,
		);
		this.name = 'CommandFailedError';
	}
}
