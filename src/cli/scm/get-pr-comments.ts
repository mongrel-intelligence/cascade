import { getPRComments } from '../../gadgets/github/core/getPRComments.js';
import { getPRCommentsDef } from '../../gadgets/github/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(getPRCommentsDef, async (params) => {
	return getPRComments(params.owner as string, params.repo as string, params.prNumber as number);
});
