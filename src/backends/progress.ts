import {
	formatGitHubProgressComment,
	formatStatusMessage,
	getStatusUpdateConfig,
} from '../config/statusUpdateConfig.js';
import { getSessionState } from '../gadgets/sessionState.js';
import { githubClient } from '../github/client.js';
import { trelloClient } from '../trello/client.js';
import type { LogWriter, ProgressReporter } from './types.js';

export interface ProgressReporterConfig {
	logWriter: LogWriter;
	trello?: {
		cardId: string;
		agentType: string;
		maxIterations: number;
	};
	github?: {
		owner: string;
		repo: string;
		headerMessage: string;
		agentType: string;
		maxIterations: number;
	};
}

/**
 * Creates a ProgressReporter that wraps existing Trello/GitHub status update logic.
 */
export function createProgressReporter(config: ProgressReporterConfig): ProgressReporter {
	const { logWriter } = config;

	return {
		async onIteration(iteration: number, maxIterations: number): Promise<void> {
			if (config.trello) {
				const statusConfig = getStatusUpdateConfig(config.trello.agentType);
				if (
					statusConfig.enabled &&
					iteration > 0 &&
					iteration % statusConfig.intervalIterations === 0
				) {
					try {
						const message = formatStatusMessage(iteration, maxIterations, config.trello.agentType);
						await trelloClient.addComment(config.trello.cardId, message);
						logWriter('INFO', 'Posted status update to Trello', {
							iteration,
							cardId: config.trello.cardId,
						});
					} catch (err) {
						logWriter('WARN', 'Failed to post status update', {
							iteration,
							error: String(err),
						});
					}
				}
			}

			if (config.github) {
				const statusConfig = getStatusUpdateConfig(config.github.agentType);
				if (
					statusConfig.enabled &&
					iteration > 0 &&
					iteration % statusConfig.intervalIterations === 0
				) {
					const { initialCommentId } = getSessionState();
					if (initialCommentId) {
						try {
							const body = formatGitHubProgressComment(
								config.github.headerMessage,
								iteration,
								maxIterations,
								config.github.agentType,
							);
							await githubClient.updatePRComment(
								config.github.owner,
								config.github.repo,
								initialCommentId,
								body,
							);
							logWriter('INFO', 'Updated GitHub PR comment with progress', {
								iteration,
								commentId: initialCommentId,
							});
						} catch (err) {
							logWriter('WARN', 'Failed to update GitHub PR comment', {
								iteration,
								error: String(err),
							});
						}
					}
				}
			}
		},

		onToolCall(toolName: string, params?: Record<string, unknown>): void {
			logWriter('DEBUG', 'Tool call', { toolName, params });
		},

		onText(content: string): void {
			logWriter('DEBUG', 'Agent text output', { length: content.length });
		},
	};
}
