/**
 * PMLifecycleManager — extracts the label/move/comment lifecycle from webhook
 * handlers into a reusable, PM-agnostic manager.
 *
 * Both Trello and JIRA webhook handlers call this instead of directly
 * manipulating labels, statuses, and comments.
 */

import type { ProjectConfig } from '../types/index.js';
import { safeOperation, silentOperation } from '../utils/safeOperation.js';
import { pmRegistry } from './registry.js';
import type { PMProvider } from './types.js';

/**
 * Normalized PM config — resolved from either project.trello or project.jira config.
 */
export interface ProjectPMConfig {
	labels: {
		processing?: string;
		processed?: string;
		error?: string;
		readyToProcess?: string;
	};
	statuses: {
		inProgress?: string;
		inReview?: string;
		done?: string;
		merged?: string;
	};
}

/**
 * Extract a human-readable PR title from a GitHub PR URL.
 * E.g. "https://github.com/owner/repo/pull/123" → "Pull Request #123"
 */
export function extractPRTitle(prUrl: string): string {
	const match = prUrl.match(/\/pull\/(\d+)/);
	return match ? `Pull Request #${match[1]}` : 'Pull Request';
}

/**
 * Resolve PM-specific config (labels, statuses) from project configuration.
 * Delegates to the registered integration's resolveLifecycleConfig().
 */
export function resolveProjectPMConfig(project: ProjectConfig): ProjectPMConfig {
	return pmRegistry.resolveLifecycleConfig(project);
}

export class PMLifecycleManager {
	constructor(
		private provider: PMProvider,
		private pmConfig: ProjectPMConfig,
	) {}

	async prepareForAgent(workItemId: string, agentType: string): Promise<void> {
		await this.safeAddLabel(workItemId, this.pmConfig.labels.processing);
		await this.safeRemoveLabel(workItemId, this.pmConfig.labels.readyToProcess);
		await this.safeRemoveLabel(workItemId, this.pmConfig.labels.processed);

		if (agentType === 'implementation') {
			await this.safeMove(workItemId, this.pmConfig.statuses.inProgress);
		}
	}

	async handleSuccess(
		workItemId: string,
		agentType: string,
		prUrl?: string,
		progressCommentId?: string,
	): Promise<void> {
		await this.safeAddLabel(workItemId, this.pmConfig.labels.processed);

		if (agentType === 'implementation') {
			await this.safeMove(workItemId, this.pmConfig.statuses.inReview);
			if (prUrl) {
				const prTitle = extractPRTitle(prUrl);
				let linked = false;
				try {
					await this.provider.linkPR(workItemId, prUrl, prTitle);
					linked = true;
				} catch {
					// linkPR failed — fall through to comment fallback
				}
				if (!linked) {
					const message = `PR created: ${prUrl}`;
					if (progressCommentId) {
						// Replace the progress comment with the "PR created" message
						await this.safeUpdateOrAddComment(workItemId, progressCommentId, message);
					} else {
						await this.safeAddComment(workItemId, message);
					}
				}
			}
		}
	}

	async handleFailure(workItemId: string, error?: string): Promise<void> {
		await this.safeAddLabel(workItemId, this.pmConfig.labels.error);
		if (error) {
			await this.safeAddComment(workItemId, `❌ Agent failed: ${error}`);
		}
	}

	async handleBudgetExceeded(
		workItemId: string,
		currentCost: number,
		budget: number,
	): Promise<void> {
		await this.safeRemoveLabel(workItemId, this.pmConfig.labels.processing);
		await this.safeAddLabel(workItemId, this.pmConfig.labels.error);
		await this.safeAddComment(
			workItemId,
			`⛔ Budget exceeded: cost $${currentCost.toFixed(2)} >= limit $${budget.toFixed(2)}. Agent not started.`,
		);
	}

	async handleBudgetWarning(
		workItemId: string,
		currentCost: number,
		budget: number,
	): Promise<void> {
		await this.safeAddLabel(workItemId, this.pmConfig.labels.error);
		await this.safeAddComment(
			workItemId,
			`⚠️ Budget limit reached: cost $${currentCost.toFixed(2)} >= limit $${budget.toFixed(2)}. Further agent runs will be blocked.`,
		);
	}

	async cleanupProcessing(workItemId: string): Promise<void> {
		await this.safeRemoveLabel(workItemId, this.pmConfig.labels.processing);
	}

	async handleError(workItemId: string, error: string): Promise<void> {
		await this.safeAddLabel(workItemId, this.pmConfig.labels.error);
		await this.safeAddComment(workItemId, `❌ Error: ${error}`);
	}

	// --- Helpers ---

	private async safeAddLabel(workItemId: string, label?: string): Promise<void> {
		if (!label) return;
		await safeOperation(() => this.provider.addLabel(workItemId, label), {
			action: 'add label',
			label,
		});
	}

	private async safeRemoveLabel(workItemId: string, label?: string): Promise<void> {
		if (!label) return;
		await silentOperation(() => this.provider.removeLabel(workItemId, label));
	}

	private async safeMove(workItemId: string, destination?: string): Promise<void> {
		if (!destination) return;
		await safeOperation(() => this.provider.moveWorkItem(workItemId, destination), {
			action: 'move work item',
			destination,
		});
	}

	private async safeAddComment(workItemId: string, text: string): Promise<void> {
		await safeOperation(() => this.provider.addComment(workItemId, text), {
			action: 'add comment',
		});
	}

	/**
	 * Try to update an existing comment; fall back to adding a new comment if the
	 * update fails (e.g. the comment was deleted between when the progress monitor
	 * recorded its ID and now).
	 */
	private async safeUpdateOrAddComment(
		workItemId: string,
		commentId: string,
		text: string,
	): Promise<void> {
		try {
			await this.provider.updateComment(workItemId, commentId, text);
		} catch {
			await this.safeAddComment(workItemId, text);
		}
	}
}
