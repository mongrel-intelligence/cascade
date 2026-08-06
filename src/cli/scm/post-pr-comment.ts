import { postPRComment } from '../../gadgets/github/core/postPRComment.js';
import { postPRCommentDef } from '../../gadgets/github/definitions.js';
import { postMRNote } from '../../gadgets/gitlab/core/postMRNote.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';
import { detectSCMProvider, resolveProjectPath } from '../base.js';

export default createCLICommand(postPRCommentDef, async (params) => {
	if (detectSCMProvider() === 'gitlab') {
		const projectPath = resolveProjectPath();
		return postMRNote(projectPath, params.prNumber as number, params.body as string);
	}
	return postPRComment(
		params.owner as string,
		params.repo as string,
		params.prNumber as number,
		params.body as string,
	);
});
