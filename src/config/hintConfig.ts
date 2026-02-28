import { execSync } from 'node:child_process';
import type { TrailingMessage } from 'llmist';
import { resolveAgentDefinition } from '../agents/definitions/index.js';
import {
	formatDiagnosticStatus,
	getDiagnosticLoopFiles,
	hasAnyDiagnosticErrors,
} from '../gadgets/shared/diagnosticState.js';
import { formatTodoList, loadTodos } from '../gadgets/todo/storage.js';

/**
 * Get the agent-specific hint for batch processing.
 * Reads from agent definition (DB → YAML fallback); falls back to a default for unknown types.
 */
async function getAgentHint(agentType?: string): Promise<string> {
	if (agentType) {
		try {
			const def = await resolveAgentDefinition(agentType);
			if (def) return def.hint;
		} catch {
			// Unknown agent type — fall through to default
		}
	}
	return 'Complete the current task efficiently before moving to the next.';
}

/**
 * Run a shell command and return output, or null on error.
 */
function runCommand(command: string): string | null {
	try {
		return execSync(command, { encoding: 'utf-8', timeout: 5000 }).trim();
	} catch {
		return null;
	}
}

/**
 * Get git status output (short format for brevity).
 */
function getGitStatus(): string | null {
	return runCommand('git status --short');
}

/**
 * Get PR view output if a PR exists for current branch.
 */
function getPRView(): string | null {
	return runCommand('gh pr view 2>/dev/null');
}

/**
 * Get current timestamp with millisecond precision.
 * Format: YYYY-MM-DD HH:mm:ss.SSS
 */
function getCurrentTimestamp(): string {
	const now = new Date();
	const pad = (n: number, len = 2) => n.toString().padStart(len, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

/**
 * Format the iteration status line with appropriate urgency indicator.
 */
function formatIterationStatus(
	iteration: number,
	maxIterations: number,
	batchHint: string,
): string {
	const remaining = maxIterations - iteration;
	const percent = Math.round((iteration / maxIterations) * 100);

	if (percent >= 80) {
		return `🚨 Iteration ${iteration}/${maxIterations} (${percent}% used, ${remaining} remaining) - ${batchHint}`;
	}

	if (percent >= 50) {
		return `⚠️ Iteration ${iteration}/${maxIterations} (${percent}% used, ${remaining} remaining) - ${batchHint}`;
	}

	return `Iteration ${iteration}/${maxIterations} (${percent}% used, ${remaining} remaining) - ${batchHint}`;
}

/**
 * Build the full trailing message with all optional sections.
 */
function buildFullTrailingMessage(
	timestamp: string,
	iterationStatus: string,
	flags: {
		includeDiagnostics?: boolean;
		includeTodoProgress?: boolean;
		includeGitStatus?: boolean;
		includePRStatus?: boolean;
		includeReminder?: boolean;
	},
): string {
	const sections: string[] = [timestamp, iterationStatus];

	if (flags.includeDiagnostics && hasAnyDiagnosticErrors()) {
		sections.push(formatDiagnosticStatus());
		const loopWarning = formatDiagnosticLoopWarning();
		if (loopWarning) sections.push(loopWarning);
	}

	if (flags.includeTodoProgress) {
		const todos = loadTodos();
		if (todos.length > 0) {
			sections.push(`## Current Progress\n\n${formatTodoList(todos)}`);
		}
	}

	if (flags.includeGitStatus) {
		const gitStatus = getGitStatus();
		sections.push(
			gitStatus
				? `## Git Status\n\n\`\`\`\n${gitStatus}\n\`\`\``
				: '## Git Status\n\nNo uncommitted changes.',
		);
	}

	if (flags.includePRStatus) {
		const prView = getPRView();
		sections.push(
			prView
				? `## PR Status\n\n\`\`\`\n${prView}\n\`\`\``
				: '## PR Status\n\nNo PR exists for current branch.',
		);
	}

	if (flags.includeReminder) {
		sections.push(
			'## Reminder\n\nCall multiple gadgets in a single response when you know which ones you need. ' +
				'For example, read multiple related files at once, or make multiple independent edits together.',
		);
	}

	return sections.join('\n\n');
}

/**
 * Format a diagnostic loop warning for files that have been edited multiple times
 * with diagnostic errors persisting after each edit.
 */
function formatDiagnosticLoopWarning(): string | null {
	const loopFiles = getDiagnosticLoopFiles();
	const loopEntries = Array.from(loopFiles.entries()).filter(([, count]) => count >= 2);

	if (loopEntries.length === 0) return null;

	const lines: string[] = ['## ⚠️ Diagnostic Loop Detected', ''];

	for (const [filePath, count] of loopEntries) {
		lines.push(
			`**${filePath}** has been edited ${count} times with diagnostic errors persisting after each edit.`,
		);
	}

	lines.push(
		'',
		'Your edits may be causing cascading errors in dependent files. STOP and:',
		'- Read the error output from your last edit — if errors are in OTHER files, read those files first',
		'- Consider whether a simpler fix (like a lint-suppression comment) would avoid the cascade',
		'- If removing a type breaks consumers, the original type choice was likely intentional',
	);

	return lines.join('\n');
}

/**
 * Get trailing message function for iteration tracking.
 *
 * Injects iteration budget awareness into each LLM call:
 * - Always shows current iteration, remaining count, and percentage
 * - Adds urgency indicator when running low on iterations
 * - Includes agent-specific batch processing hints
 * - Uses agent definition trailingMessage flags to decide which extra sections to include
 *
 * Note: Loop detection warnings are injected as separate user messages
 * (see agentLoop.ts) rather than in trailing messages for higher visibility.
 *
 * Trailing messages are ephemeral - they appear in each request but don't
 * persist to conversation history, keeping context clean.
 *
 * @param agentType - The type of agent (e.g., 'implementation', 'review')
 * @returns Promise resolving to trailing message function
 */
export async function getIterationTrailingMessage(agentType?: string): Promise<TrailingMessage> {
	const batchHint = await getAgentHint(agentType);

	// Resolve trailing message flags from agent definition (DB → YAML fallback)
	let flags: {
		includeDiagnostics?: boolean;
		includeTodoProgress?: boolean;
		includeGitStatus?: boolean;
		includePRStatus?: boolean;
		includeReminder?: boolean;
	} = {};

	if (agentType) {
		try {
			const def = await resolveAgentDefinition(agentType);
			if (def) {
				flags = def.trailingMessage ?? {};
			}
		} catch {
			// Unknown agent type — use empty flags (basic message only)
		}
	}

	const hasAnyFlag = Object.values(flags).some(Boolean);

	return (ctx) => {
		const timestamp = `**Timestamp:** ${getCurrentTimestamp()}`;
		const iterationStatus = formatIterationStatus(ctx.iteration, ctx.maxIterations, batchHint);

		if (hasAnyFlag) {
			return buildFullTrailingMessage(timestamp, iterationStatus, flags);
		}

		return `${timestamp}\n\n${iterationStatus}`;
	};
}
