import { createGadgetClass } from '../shared/gadgetFactory.js';
import { replyToReviewComment } from './core/replyToReviewComment.js';
import { replyToReviewCommentDef } from './definitions.js';

export const ReplyToReviewComment = createGadgetClass(replyToReviewCommentDef, async (params) => {
	return replyToReviewComment(
		params.owner as string,
		params.repo as string,
		params.prNumber as number,
		params.commentId as number,
		params.body as string,
	);
});
