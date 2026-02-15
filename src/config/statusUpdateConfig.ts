/**
 * Status update configuration for periodic Trello card updates.
 *
 * Agents can post status comments to Trello cards every N iterations
 * to provide visibility into long-running sessions.
 */

import { formatTodoList, loadTodos } from '../gadgets/todo/storage.js';

/**
 * Configuration for periodic status updates.
 */
export interface StatusUpdateConfig {
	/** Whether status updates are enabled */
	enabled: boolean;
	/** Number of minutes between status updates */
	intervalMinutes: number;
	/** Model to use for progress summaries */
	progressModel: string;
}

/**
 * Default status update settings.
 */
const DEFAULT_STATUS_UPDATE_CONFIG: StatusUpdateConfig = {
	enabled: true,
	intervalMinutes: 5,
	progressModel: 'openrouter:google/gemini-2.5-flash-lite',
};

/**
 * Get status update configuration for a given agent type.
 *
 * @param agentType - Type of agent (e.g., "implementation", "planning")
 * @returns Status update configuration
 */
export function getStatusUpdateConfig(agentType: string): StatusUpdateConfig {
	// Currently all agents use the same config, but this allows
	// per-agent customization in the future
	if (agentType === 'debug') {
		// Debug agent doesn't need status updates (analyzing logs, not modifying code)
		return {
			enabled: false,
			intervalMinutes: 5,
			progressModel: DEFAULT_STATUS_UPDATE_CONFIG.progressModel,
		};
	}
	return { ...DEFAULT_STATUS_UPDATE_CONFIG };
}

/**
 * Format a status update message for posting to Trello.
 *
 * @param iteration - Current iteration number
 * @param maxIterations - Maximum allowed iterations
 * @param agentType - Type of agent posting the update
 * @returns Formatted markdown message
 */
export function formatStatusMessage(
	iteration: number,
	maxIterations: number,
	agentType: string,
): string {
	const progress = Math.round((iteration / maxIterations) * 100);
	const progressBar = createProgressBar(progress);

	// Get current todo status
	const todos = loadTodos();
	const inProgressTodo = todos.find((t) => t.status === 'in_progress');
	const doneCount = todos.filter((t) => t.status === 'done').length;
	const totalCount = todos.length;

	const lines = [
		`**${agentType} agent progress**`,
		'',
		`${progressBar} ${progress}% (iteration ${iteration}/${maxIterations})`,
	];

	if (totalCount > 0) {
		lines.push('', `**Tasks:** ${doneCount}/${totalCount} complete`);
		if (inProgressTodo) {
			lines.push(`**Working on:** ${inProgressTodo.content}`);
		}
	}

	return lines.join('\n');
}

/**
 * Format a GitHub progress comment that updates the initial PR comment.
 *
 * Renders a progress bar, todo list, and metadata footer.
 *
 * @param headerMessage - Original comment text preserved as header (e.g., "🔍 Reviewing PR...")
 * @param iteration - Current iteration number
 * @param maxIterations - Maximum allowed iterations
 * @param agentType - Type of agent posting the update
 * @returns Formatted markdown comment body
 */
export function formatGitHubProgressComment(
	headerMessage: string,
	iteration: number,
	maxIterations: number,
	agentType: string,
): string {
	const progress = Math.round((iteration / maxIterations) * 100);
	const progressBar = createProgressBar(progress);

	const todos = loadTodos();
	const todoSection = formatTodoList(todos);

	const lines = [
		headerMessage,
		'',
		'---',
		'',
		`**Progress:** ${progressBar} ${progress}% (iteration ${iteration}/${maxIterations})`,
		'',
		todoSection,
		'',
		`<sub>Last updated: iteration ${iteration} · ${agentType} agent</sub>`,
	];

	return lines.join('\n');
}

/**
 * Create a text-based progress bar.
 */
function createProgressBar(percent: number): string {
	const filled = Math.round(percent / 10);
	const empty = 10 - filled;
	return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}
