import { createGadgetClass } from '../shared/gadgetFactory.js';
import { formatGadgetError } from '../utils.js';
import { updatePRComment } from './core/updatePRComment.js';
import { updatePRCommentDef } from './definitions.js';

export const UpdatePRComment = createGadgetClass(updatePRCommentDef, async (params) => {
	try {
		const result = await updatePRComment(
			params.owner as string,
			params.repo as string,
			params.commentId as number,
			params.body as string,
		);
		return `Comment updated (id: ${result.id}): ${result.url ?? ''}`;
	} catch (error) {
		return formatGadgetError('updating PR comment', error);
	}
});
