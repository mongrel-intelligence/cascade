import { createGadgetClass } from '../shared/gadgetFactory.js';
import { formatGadgetError } from '../utils.js';
import { postPRComment } from './core/postPRComment.js';
import { postPRCommentDef } from './definitions.js';

export const PostPRComment = createGadgetClass(postPRCommentDef, async (params) => {
	try {
		const result = await postPRComment(
			params.owner as string,
			params.repo as string,
			params.prNumber as number,
			params.body as string,
		);
		return `Comment posted (id: ${result.id}): ${result.url ?? ''}`;
	} catch (error) {
		return formatGadgetError('posting PR comment', error);
	}
});
