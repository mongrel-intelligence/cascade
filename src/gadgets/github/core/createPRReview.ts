import { githubClient } from '../../../github/client.js';

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
	const review = await githubClient.createPRReview(
		params.owner,
		params.repo,
		params.prNumber,
		params.event,
		params.body,
		params.comments,
	);
	return { reviewUrl: review.htmlUrl, event: params.event };
}
