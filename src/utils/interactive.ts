import * as readline from 'node:readline';
import chalk from 'chalk';

const BOX_WIDTH = 70;
const HORIZONTAL = '\u2500';

function horizontalLine(): string {
	return HORIZONTAL.repeat(BOX_WIDTH);
}

function contentLine(content: string): string {
	return content;
}

function stripAnsi(str: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Required for ANSI escape sequence stripping
	return str.replace(/\x1B\[[0-9;]*m/g, '');
}

function wrapText(text: string, maxWidth: number): string[] {
	const lines: string[] = [];
	const inputLines = text.split('\n');

	for (const line of inputLines) {
		if (stripAnsi(line).length <= maxWidth) {
			lines.push(line);
		} else {
			// Simple word wrap
			let remaining = line;
			while (stripAnsi(remaining).length > maxWidth) {
				let breakPoint = maxWidth;
				// Try to break at a space
				const visiblePart = remaining.slice(0, maxWidth * 2); // Account for ANSI codes
				const spaceIndex = visiblePart.lastIndexOf(' ');
				if (spaceIndex > maxWidth / 2) {
					breakPoint = spaceIndex;
				}
				lines.push(remaining.slice(0, breakPoint));
				remaining = remaining.slice(breakPoint).trimStart();
			}
			if (remaining) {
				lines.push(remaining);
			}
		}
	}

	return lines;
}

/**
 * Display EditFile params with search/replace as separate colored blocks.
 */
function displayEditFileParams(params: Record<string, unknown>): void {
	const maxContentWidth = BOX_WIDTH;

	// File path
	if (params.filePath) {
		console.log(contentLine(chalk.dim('File: ') + chalk.cyan(String(params.filePath))));
		console.log(horizontalLine());
	}

	// Search block (what's being replaced) - red
	if (params.search !== undefined) {
		console.log(contentLine(chalk.red('━ Search (to replace):')));
		const searchLines = wrapText(String(params.search), maxContentWidth);
		for (const line of searchLines) {
			console.log(contentLine(chalk.red(line)));
		}
		console.log(horizontalLine());
	}

	// Replace block (new content) - green
	if (params.replace !== undefined) {
		console.log(contentLine(chalk.green('+ Replace (new content):')));
		const replaceLines = wrapText(String(params.replace), maxContentWidth);
		for (const line of replaceLines) {
			console.log(contentLine(chalk.green(line)));
		}
	}
}

/**
 * Display default params as JSON.
 */
function displayDefaultParams(params: Record<string, unknown>): void {
	const maxContentWidth = BOX_WIDTH;
	const paramsJson = JSON.stringify(params, null, 2);
	const paramLines = wrapText(paramsJson, maxContentWidth);

	console.log(contentLine(chalk.dim('Parameters:')));
	for (const line of paramLines) {
		console.log(contentLine(chalk.yellow(line)));
	}
}

export function displayGadgetCall(
	name: string,
	params: Record<string, unknown>,
	isSynthetic: boolean,
): void {
	console.log('');
	console.log(horizontalLine());

	if (isSynthetic) {
		console.log(contentLine(chalk.dim(`[SYNTHETIC] ${chalk.cyan(name)}`)));
	} else {
		console.log(contentLine(chalk.bold(`GADGET CALL: ${chalk.cyan(name)}`)));
	}

	console.log(horizontalLine());

	// Special formatting for EditFile
	if (name === 'EditFile') {
		displayEditFileParams(params);
	} else {
		displayDefaultParams(params);
	}

	console.log(horizontalLine());
}

export function displayGadgetResult(
	name: string,
	result: string | undefined,
	error: string | undefined,
	executionTimeMs: number,
): void {
	const maxContentWidth = BOX_WIDTH;

	console.log('');
	console.log(horizontalLine());

	const timeStr = chalk.dim(`(${executionTimeMs}ms)`);
	if (error) {
		console.log(contentLine(`${chalk.red('\u2717 ERROR:')} ${chalk.cyan(name)} ${timeStr}`));
	} else {
		console.log(contentLine(`${chalk.green('\u2713 RESULT:')} ${chalk.cyan(name)} ${timeStr}`));
	}

	console.log(horizontalLine());

	const content = error || result || '(no output)';
	const lines = wrapText(content, maxContentWidth);

	for (const line of lines) {
		if (error) {
			console.log(contentLine(chalk.red(line)));
		} else {
			console.log(contentLine(chalk.green(line)));
		}
	}

	console.log(horizontalLine());
}

export function displayLLMText(content: string): void {
	const maxContentWidth = BOX_WIDTH;

	console.log('');
	console.log(horizontalLine());
	console.log(contentLine(chalk.bold(`${chalk.magenta('◆')} LLM Response`)));
	console.log(horizontalLine());

	const lines = wrapText(content, maxContentWidth);
	for (const line of lines) {
		console.log(contentLine(line));
	}

	console.log(horizontalLine());
}

export async function waitForEnter(): Promise<void> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(chalk.dim('Press Enter to execute...'), () => {
			rl.close();
			resolve();
		});
	});
}
