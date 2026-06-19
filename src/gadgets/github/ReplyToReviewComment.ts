import { createGadgetClass } from '../shared/gadgetFactory.js';
import { formatGadgetError } from '../utils.js';
import { replyToReviewComment } from './core/replyToReviewComment.js';
import { replyToReviewCommentDef } from './definitions.js';

export const ReplyToReviewComment = createGadgetClass(replyToReviewCommentDef, async (params) => {
	try {
		const result = await replyToReviewComment(
			params.owner as string,
			params.repo as string,
			params.prNumber as number,
			params.commentId as number,
			params.body as string,
		);
		return `Reply posted successfully: ${result.url ?? ''}`;
	} catch (error) {
		return formatGadgetError('replying to comment', error);
	}
});
