import { createGadgetClass } from '../shared/gadgetFactory.js';
import { postComment } from './core/postComment.js';
import { postCommentDef } from './definitions.js';

export const PostComment = createGadgetClass(postCommentDef, async (params) => {
	return postComment(params.workItemId as string, params.text as string);
});
