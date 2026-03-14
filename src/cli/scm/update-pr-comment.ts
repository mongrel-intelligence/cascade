import { updatePRComment } from '../../gadgets/github/core/updatePRComment.js';
import { updatePRCommentDef } from '../../gadgets/github/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(updatePRCommentDef, async (params) => {
	return updatePRComment(
		params.owner as string,
		params.repo as string,
		params.commentId as number,
		params.body as string,
	);
});
