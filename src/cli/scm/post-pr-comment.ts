import { postPRComment } from '../../gadgets/github/core/postPRComment.js';
import { postPRCommentDef } from '../../gadgets/github/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(postPRCommentDef, async (params) => {
	return postPRComment(
		params.owner as string,
		params.repo as string,
		params.prNumber as number,
		params.body as string,
	);
});
