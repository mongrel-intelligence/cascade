import { deleteInitialComment, recordReviewSubmission } from '../sessionState.js';
import { createGadgetClass } from '../shared/gadgetFactory.js';
import { formatGadgetError } from '../utils.js';
import { createMRReview } from './core/createMRReview.js';
import { createMRReviewDef } from './definitions.js';

export const CreateMRReview = createGadgetClass(createMRReviewDef, async (params) => {
	try {
		const result = await createMRReview({
			projectPath: params.projectPath as string,
			mrIid: params.mrIid as number,
			event: params.event as 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
			body: params.body as string,
		});
		recordReviewSubmission('', params.body as string, result.event);
		// Delete the stale ack/progress comment immediately after review submission.
		// Best-effort: wrapped in deleteInitialComment's own try-catch.
		// Note: GitLab doesn't use owner/repo, passing projectPath as owner for compatibility.
		await deleteInitialComment(params.projectPath as string, '');
		return `Review submitted successfully (${result.event})`;
	} catch (error) {
		return formatGadgetError('submitting review', error);
	}
});
