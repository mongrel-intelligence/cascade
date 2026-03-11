import { deleteInitialComment, recordReviewSubmission } from '../sessionState.js';
import { createGadgetClass } from '../shared/gadgetFactory.js';
import { formatGadgetError } from '../utils.js';
import { createPRReview } from './core/createPRReview.js';
import { createPRReviewDef } from './definitions.js';

export const CreatePRReview = createGadgetClass(createPRReviewDef, async (params) => {
	try {
		const result = await createPRReview({
			owner: params.owner as string,
			repo: params.repo as string,
			prNumber: params.prNumber as number,
			event: params.event as 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
			body: params.body as string,
			comments: params.comments as Array<{ path: string; line?: number; body: string }> | undefined,
		});
		recordReviewSubmission(result.reviewUrl, params.body as string, result.event);
		// Delete the stale ack/progress comment immediately after review submission.
		// Best-effort: wrapped in deleteInitialComment's own try-catch.
		await deleteInitialComment(params.owner as string, params.repo as string);
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
