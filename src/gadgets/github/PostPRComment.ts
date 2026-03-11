import { createGadgetClass } from '../shared/gadgetFactory.js';
import { postPRComment } from './core/postPRComment.js';
import { postPRCommentDef } from './definitions.js';

export const PostPRComment = createGadgetClass(postPRCommentDef, async (params) => {
	return postPRComment(
		params.owner as string,
		params.repo as string,
		params.prNumber as number,
		params.body as string,
	);
});
