import { createGadgetClass } from '../shared/gadgetFactory.js';
import { formatGadgetError } from '../utils.js';
import { postComment } from './core/postComment.js';
import { postCommentDef } from './definitions.js';

export const PostComment = createGadgetClass(postCommentDef, async (params) => {
	try {
		await postComment(params.workItemId as string, params.text as string);
		return 'Comment posted successfully';
	} catch (error) {
		return formatGadgetError('posting comment', error);
	}
});
