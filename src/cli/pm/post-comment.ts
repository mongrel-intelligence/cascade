import { isPmPostingEnabled, UPDATE_CHANNELS } from '../../config/updateChannel.js';
import { postComment } from '../../gadgets/pm/core/postComment.js';
import { postCommentDef } from '../../gadgets/pm/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

export default createCLICommand(postCommentDef, async (params) => {
	// Honor the update channel injected by the orchestrator. When PM posting is
	// disabled (scm-only / none), return a structured skip so the agent sees a
	// clear explanation rather than silently posting anyway.
	const rawChannel = process.env.CASCADE_UPDATE_CHANNEL;
	const channel = UPDATE_CHANNELS.includes(rawChannel as (typeof UPDATE_CHANNELS)[number])
		? (rawChannel as (typeof UPDATE_CHANNELS)[number])
		: 'both';
	if (!isPmPostingEnabled(channel)) {
		return { skipped: true, reason: `PM posting disabled by update channel (${channel})` };
	}
	return postComment(params.workItemId as string, params.text as string);
});
