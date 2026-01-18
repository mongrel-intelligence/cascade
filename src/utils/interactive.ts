import * as readline from 'node:readline';
import chalk from 'chalk';

const BOX_WIDTH = 70;
const HORIZONTAL = '\u2500';

function horizontalLine(): string {
	return HORIZONTAL.repeat(BOX_WIDTH);
}

/**
 * Display FileSearchAndReplace params.
 */
function displayFileSearchAndReplaceParams(params: Record<string, unknown>): void {
	// Comment (rationale for the edit)
	if (params.comment) {
		console.log(chalk.dim('Comment: ') + chalk.white(String(params.comment)));
	}

	// File path
	if (params.filePath) {
		console.log(`${chalk.dim('File: ')}${chalk.cyan(String(params.filePath))}`);
		console.log(horizontalLine());
	}

	displaySearchReplaceMode(params);
}

/**
 * Display FileInsertContent params.
 */
function displayFileInsertContentParams(params: Record<string, unknown>): void {
	// Comment (rationale for the edit)
	if (params.comment) {
		console.log(chalk.dim('Comment: ') + chalk.white(String(params.comment)));
	}

	// File path
	if (params.filePath) {
		console.log(`${chalk.dim('File: ')}${chalk.cyan(String(params.filePath))}`);
		console.log(horizontalLine());
	}

	displayInsertAtLineMode(params);
}

/**
 * Display FileRemoveContent params.
 */
function displayFileRemoveContentParams(params: Record<string, unknown>): void {
	// Comment (rationale for the edit)
	if (params.comment) {
		console.log(chalk.dim('Comment: ') + chalk.white(String(params.comment)));
	}

	// File path
	if (params.filePath) {
		console.log(`${chalk.dim('File: ')}${chalk.cyan(String(params.filePath))}`);
		console.log(horizontalLine());
	}

	displayRemoveLinesMode(params);
}

/**
 * Display search_replace mode params.
 */
function displaySearchReplaceMode(params: Record<string, unknown>): void {
	// Search block (what's being replaced) - red
	if (params.search !== undefined) {
		console.log(chalk.red('━ Search (to replace):'));
		for (const line of String(params.search).split('\n')) {
			console.log(chalk.red(line));
		}
		console.log(horizontalLine());
	}

	// Replace block (new content) - green
	if (params.replace !== undefined) {
		console.log(chalk.green('+ Replace (new content):'));
		for (const line of String(params.replace).split('\n')) {
			console.log(chalk.green(line));
		}
	}
}

/**
 * Display insert_at_line mode params.
 */
function displayInsertAtLineMode(params: Record<string, unknown>): void {
	const lineNum = params.line !== undefined ? String(params.line) : '?';
	console.log(chalk.green(`+ Insert BEFORE line ${lineNum}:`));

	if (params.content !== undefined) {
		for (const line of String(params.content).split('\n')) {
			console.log(chalk.green(line));
		}
	}
}

/**
 * Display remove_lines mode params.
 */
function displayRemoveLinesMode(params: Record<string, unknown>): void {
	const startLine = params.startLine !== undefined ? String(params.startLine) : '?';
	const endLine = params.endLine !== undefined ? String(params.endLine) : '?';

	if (startLine === endLine) {
		console.log(chalk.red(`━ Remove line ${startLine}`));
	} else {
		console.log(chalk.red(`━ Remove lines ${startLine}-${endLine}`));
	}
}

/**
 * Display default params as JSON.
 */
function displayDefaultParams(params: Record<string, unknown>): void {
	const paramsJson = JSON.stringify(params, null, 2);

	console.log(chalk.dim('Parameters:'));
	for (const line of paramsJson.split('\n')) {
		console.log(chalk.yellow(line));
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
		console.log(chalk.dim(`[SYNTHETIC] ${chalk.cyan(name)}`));
	} else {
		console.log(chalk.bold(`GADGET CALL: ${chalk.cyan(name)}`));
	}

	console.log(horizontalLine());

	// Special formatting for file editing gadgets
	switch (name) {
		case 'FileSearchAndReplace':
			displayFileSearchAndReplaceParams(params);
			break;
		case 'FileInsertContent':
			displayFileInsertContentParams(params);
			break;
		case 'FileRemoveContent':
			displayFileRemoveContentParams(params);
			break;
		default:
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
	console.log('');
	console.log(horizontalLine());

	const timeStr = chalk.dim(`(${executionTimeMs}ms)`);
	if (error) {
		console.log(`${chalk.red('\u2717 ERROR:')} ${chalk.cyan(name)} ${timeStr}`);
	} else {
		console.log(`${chalk.green('\u2713 RESULT:')} ${chalk.cyan(name)} ${timeStr}`);
	}

	console.log(horizontalLine());

	const content = error || result || '(no output)';

	for (const line of content.split('\n')) {
		if (error) {
			console.log(chalk.red(line));
		} else {
			console.log(chalk.green(line));
		}
	}

	console.log(horizontalLine());
}

export function displayLLMText(content: string): void {
	console.log('');
	console.log(horizontalLine());
	console.log(chalk.bold(`${chalk.magenta('◆')} LLM Response`));
	console.log(horizontalLine());

	for (const line of content.split('\n')) {
		console.log(line);
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
