import { replyToReviewComment } from '../../gadgets/github/core/replyToReviewComment.js';
import { replyToReviewCommentDef } from '../../gadgets/github/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(replyToReviewCommentDef, async (params) => {
	return replyToReviewComment(
		params.owner as string,
		params.repo as string,
		params.prNumber as number,
		params.commentId as number,
		params.body as string,
	);
});
