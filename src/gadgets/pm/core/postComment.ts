import { clearProgressCommentId, readProgressCommentId } from '../../../backends/progressState.js';
import { getPMProvider } from '../../../pm/index.js';
import { logger } from '../../../utils/logging.js';
import { buildRunLink, buildWorkItemRunsLink, getDashboardUrl } from '../../../utils/runLink.js';

/**
 * Build the run link footer for agent-posted comments, reading env vars injected
 * by the secretBuilder for subprocess agents (claude-code/codex/opencode).
 */
function buildRunLinkFooter(workItemId: string): string {
	if (process.env.CASCADE_RUN_LINKS_ENABLED !== 'true') return '';
	const dashboardUrl = getDashboardUrl();
	if (!dashboardUrl) return '';

	const runId = process.env.CASCADE_RUN_ID;
	const engineLabel = process.env.CASCADE_ENGINE_LABEL ?? '';
	const model = process.env.CASCADE_MODEL ?? '';
	const projectId = process.env.CASCADE_PROJECT_ID ?? '';

	if (runId) {
		return buildRunLink({ dashboardUrl, runId, engineLabel, model });
	}
	if (projectId && workItemId) {
		return buildWorkItemRunsLink({ dashboardUrl, projectId, workItemId, engineLabel, model });
	}
	return '';
}

export async function postComment(workItemId: string, text: string): Promise<string> {
	try {
		const provider = getPMProvider();

		// Append run link footer when enabled via env vars (injected by secretBuilder for subprocesses)
		const runLinkFooter = buildRunLinkFooter(workItemId);
		const fullText = runLinkFooter ? text + runLinkFooter : text;

		// Check if there is a progress comment we should update instead of creating new
		const progressState = readProgressCommentId();
		if (progressState && progressState.workItemId === workItemId) {
			try {
				await provider.updateComment(workItemId, progressState.commentId, fullText);
				clearProgressCommentId();
				return 'Comment posted successfully';
			} catch (error) {
				// Fall back to creating a new comment if update fails
				logger.warn('Failed to update progress comment, creating new one', {
					workItemId,
					commentId: progressState.commentId,
					error: error instanceof Error ? error.message : String(error),
				});
				clearProgressCommentId();
			}
		}

		await provider.addComment(workItemId, fullText);
		return 'Comment posted successfully';
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error posting comment: ${message}`;
	}
}
