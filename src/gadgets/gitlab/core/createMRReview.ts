import { gitlabClient } from '../../../gitlab/client.js';
import { buildRunLinkFooterFromEnv } from '../../../utils/runLink.js';

export interface CreateMRReviewParams {
	projectPath: string;
	mrIid: number;
	event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
	body: string;
}

export interface CreateMRReviewResult {
	event: string;
}

export async function createMRReview(params: CreateMRReviewParams): Promise<CreateMRReviewResult> {
	const runLinkFooter = buildRunLinkFooterFromEnv();
	const body = runLinkFooter ? params.body + runLinkFooter : params.body;

	if (params.event === 'APPROVE') {
		await gitlabClient.approveMR(params.projectPath, params.mrIid);
	} else if (params.event === 'REQUEST_CHANGES') {
		await gitlabClient.unapproveMR(params.projectPath, params.mrIid);
	}

	// Always post the review body as a note
	if (body) {
		await gitlabClient.createMRNote(params.projectPath, params.mrIid, body);
	}

	return { event: params.event };
}
