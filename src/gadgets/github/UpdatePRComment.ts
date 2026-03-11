import { createGadgetClass } from '../shared/gadgetFactory.js';
import { updatePRComment } from './core/updatePRComment.js';
import { updatePRCommentDef } from './definitions.js';

export const UpdatePRComment = createGadgetClass(updatePRCommentDef, async (params) => {
	return updatePRComment(
		params.owner as string,
		params.repo as string,
		params.commentId as number,
		params.body as string,
	);
});
