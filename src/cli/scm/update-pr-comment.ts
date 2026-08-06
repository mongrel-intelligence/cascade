import { updatePRComment } from '../../gadgets/github/core/updatePRComment.js';
import { updatePRCommentDef } from '../../gadgets/github/definitions.js';
import { updateMRNote } from '../../gadgets/gitlab/core/updateMRNote.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';
import { detectSCMProvider, resolveProjectPath } from '../base.js';

export default createCLICommand(updatePRCommentDef, async (params) => {
	if (detectSCMProvider() === 'gitlab') {
		const projectPath = resolveProjectPath();
		// GitLab's updateMRNote requires the MR IID. The GitHub UpdatePRComment
		// definition doesn't include prNumber (GitHub comments are globally addressable).
		// For GitLab, resolve the MR IID from the prNumber param (if the agent passes it
		// as extra context) or from CASCADE_SCM_MR_IID env var.
		const mrIid =
			(params.prNumber as number | undefined) ??
			(Number(process.env.CASCADE_SCM_MR_IID) || undefined);
		if (!mrIid) {
			return 'Error: GitLab requires the MR IID to update a note. Pass --prNumber or set CASCADE_SCM_MR_IID.';
		}
		return updateMRNote(projectPath, mrIid, params.commentId as number, params.body as string);
	}
	return updatePRComment(
		params.owner as string,
		params.repo as string,
		params.commentId as number,
		params.body as string,
	);
});
