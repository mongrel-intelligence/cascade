import { githubClient } from '../../../github/client.js';
import { buildRunLinkFooterFromEnv } from '../../../utils/runLink.js';

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

export async function createPRReview(params: CreatePRReviewParams): Promise<CreatePRReviewResult> {
	const runLinkFooter = buildRunLinkFooterFromEnv();
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
