import readline from 'node:readline';

/**
 * Prompts the user with an interactive y/n confirmation for destructive actions.
 *
 * Behaviour:
 * - If `skipFlag` is true (--yes passed), auto-accepts and returns immediately.
 * - If stdin is not a TTY (piped/CI environment), auto-accepts and returns immediately.
 * - Otherwise, prints `message [y/N]:` and reads a single line from stdin.
 *   - Exits the process with code 1 if the user answers anything other than `y` or `Y`.
 */
export async function confirm(message: string, skipFlag: boolean): Promise<void> {
	// --yes flag bypasses the prompt
	if (skipFlag) {
		return;
	}

	// Non-TTY (piped/CI) — auto-accept for scripting compatibility
	if (process.stdin.isTTY === undefined || !process.stdin.isTTY) {
		return;
	}

	const answer = await askQuestion(`${message} [y/N]: `);
	if (answer.toLowerCase() !== 'y') {
		process.stdout.write('Cancelled.\n');
		process.exit(1);
	}
}

function askQuestion(prompt: string): Promise<string> {
	return new Promise((resolve) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		rl.question(prompt, (answer) => {
			rl.close();
			resolve(answer);
		});
	});
}
