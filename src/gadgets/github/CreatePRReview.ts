import { type ReviewEvent, resolveReviewEventPolicy } from '../../config/reviewEventPolicy.js';
import {
	deleteInitialComment,
	getAgentType,
	getProject,
	recordReviewSubmission,
} from '../sessionState.js';
import { createGadgetClass } from '../shared/gadgetFactory.js';
import { formatGadgetError } from '../utils.js';
import { createPRReview } from './core/createPRReview.js';
import { createPRReviewDef } from './definitions.js';

export const CreatePRReview = createGadgetClass(createPRReviewDef, async (params) => {
	try {
		// In-process (LLMist) runs don't export project secrets to process.env,
		// so resolve the review event policy from SessionState here.
		const eventPolicy = resolveReviewEventPolicy(getProject() ?? {}, getAgentType() ?? '');
		const result = await createPRReview(
			{
				owner: params.owner as string,
				repo: params.repo as string,
				prNumber: params.prNumber as number,
				event: params.event as ReviewEvent,
				body: params.body as string,
				comments: params.comments as
					| Array<{ path: string; line?: number; body: string }>
					| undefined,
			},
			{ eventPolicy },
		);
		recordReviewSubmission(result.reviewUrl, result.finalBody, result.event);
		// Delete the stale ack/progress comment immediately after review submission.
		// Best-effort: wrapped in deleteInitialComment's own try-catch.
		await deleteInitialComment(params.owner as string, params.repo as string);
		if (result.advisoryEvent !== undefined) {
			return `Review submitted as ${result.event} (comment-only review mode; advisory verdict: ${result.advisoryEvent}): ${result.reviewUrl}`;
		}
		return `Review submitted successfully (${result.event}): ${result.reviewUrl}`;
	} catch (error) {
		const baseError = formatGadgetError('submitting review', error);

		const comments = params.comments as
			| Array<{ path: string; line?: number; body: string }>
			| undefined;
		if (comments?.length) {
			const paths = comments.map((c) => `  - ${c.path}:${c.line ?? 'general'}`).join('\n');
			return `${baseError}\n\nComment paths attempted:\n${paths}`;
		}

		return baseError;
	}
});
