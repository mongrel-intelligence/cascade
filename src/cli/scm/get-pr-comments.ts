import { getPRComments } from '../../gadgets/github/core/getPRComments.js';
import { getPRCommentsDef } from '../../gadgets/github/definitions.js';
import { getMRNotes } from '../../gadgets/gitlab/core/getMRNotes.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';
import { detectSCMProvider, resolveProjectPath } from '../base.js';

export default createCLICommand(getPRCommentsDef, async (params) => {
	if (detectSCMProvider() === 'gitlab') {
		const projectPath = resolveProjectPath();
		return getMRNotes(projectPath, params.prNumber as number);
	}
	return getPRComments(params.owner as string, params.repo as string, params.prNumber as number);
});
