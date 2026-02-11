/**
 * Status update configuration for periodic Trello card updates.
 *
 * Agents can post status comments to Trello cards every N iterations
 * to provide visibility into long-running sessions.
 */

import { loadTodos } from '../gadgets/todo/storage.js';

/**
 * Configuration for periodic status updates.
 */
export interface StatusUpdateConfig {
	/** Whether status updates are enabled */
	enabled: boolean;
	/** Number of iterations between status updates */
	intervalIterations: number;
}

/**
 * Default status update settings.
 */
const DEFAULT_STATUS_UPDATE_CONFIG: StatusUpdateConfig = {
	enabled: true,
	intervalIterations: 5,
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
		return { enabled: false, intervalIterations: 5 };
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
 * Create a text-based progress bar.
 */
function createProgressBar(percent: number): string {
	const filled = Math.round(percent / 10);
	const empty = 10 - filled;
	return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}
