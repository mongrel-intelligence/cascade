import { replyToReviewComment } from '../../gadgets/github/core/replyToReviewComment.js';
import { replyToReviewCommentDef } from '../../gadgets/github/definitions.js';
import { postMRNote } from '../../gadgets/gitlab/core/postMRNote.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';
import { detectSCMProvider, resolveProjectPath } from '../base.js';

export default createCLICommand(replyToReviewCommentDef, async (params) => {
	if (detectSCMProvider() === 'gitlab') {
		const projectPath = resolveProjectPath();
		// For GitLab, replying to a review comment maps to posting a new note on the MR.
		// GitLab discussion threading is handled at the API level differently from GitHub.
		return postMRNote(projectPath, params.prNumber as number, params.body as string);
	}
	return replyToReviewComment(
		params.owner as string,
		params.repo as string,
		params.prNumber as number,
		params.commentId as number,
		params.body as string,
	);
});
