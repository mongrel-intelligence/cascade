import { githubClient } from '../../../github/client.js';
import { buildRunLink, buildWorkItemRunsLink, getDashboardUrl } from '../../../utils/runLink.js';

export interface CreatePRReviewParams {
	owner: string;
	repo: string;
	prNumber: number;
	event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
	body: string;
	comments?: Array<{ path: string; line?: number; body: string }>;
}

export interface CreatePRReviewResult {
	reviewUrl: string;
	event: string;
}

/**
 * Build the run link footer for PR reviews, reading env vars injected
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

export async function createPRReview(params: CreatePRReviewParams): Promise<CreatePRReviewResult> {
	const runLinkFooter = buildRunLinkFooter();
	const body = runLinkFooter ? params.body + runLinkFooter : params.body;

	const review = await githubClient.createPRReview(
		params.owner,
		params.repo,
		params.prNumber,
		params.event,
		body,
		params.comments,
	);
	return { reviewUrl: review.htmlUrl, event: params.event };
}
