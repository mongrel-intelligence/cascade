import { githubClient } from '../../../github/client.js';
import { buildRunLink, buildWorkItemRunsLink, getDashboardUrl } from '../../../utils/runLink.js';

/**
 * Build the run link footer for GitHub PR comments, reading env vars injected
 * by the secretBuilder for subprocess agents (claude-code/codex/opencode).
 */
function buildRunLinkFooter(): string {
	if (process.env.CASCADE_RUN_LINKS_ENABLED !== 'true') return '';
	const dashboardUrl = getDashboardUrl();
	if (!dashboardUrl) return '';

	const runId = process.env.CASCADE_RUN_ID;
	const engineLabel = process.env.CASCADE_ENGINE_LABEL ?? '';
	const model = process.env.CASCADE_MODEL ?? '';
	const projectId = process.env.CASCADE_PROJECT_ID ?? '';
	const workItemId = process.env.CASCADE_WORK_ITEM_ID ?? '';

	if (runId) {
		return buildRunLink({ dashboardUrl, runId, engineLabel, model });
	}
	if (projectId && workItemId) {
		return buildWorkItemRunsLink({ dashboardUrl, projectId, workItemId, engineLabel, model });
	}
	return '';
}

export async function postPRComment(
	owner: string,
	repo: string,
	prNumber: number,
	body: string,
): Promise<string> {
	try {
		const runLinkFooter = buildRunLinkFooter();
		const fullBody = runLinkFooter ? body + runLinkFooter : body;
		const result = await githubClient.createPRComment(owner, repo, prNumber, fullBody);
		return `Comment posted (id: ${result.id}): ${result.htmlUrl}`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `Error posting PR comment: ${message}`;
	}
}
