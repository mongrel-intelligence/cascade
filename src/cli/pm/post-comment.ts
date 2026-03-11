import { postComment } from '../../gadgets/pm/core/postComment.js';
import { postCommentDef } from '../../gadgets/pm/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(postCommentDef, async (params) => {
	return postComment(params.workItemId as string, params.text as string);
});
