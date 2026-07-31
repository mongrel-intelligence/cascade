import { readFileSync } from 'node:fs';
import {
	DEFAULT_UPDATE_CHANNEL,
	isPmPostingEnabled,
	UPDATE_CHANNEL_ENV_VAR,
	UPDATE_CHANNEL_FILE,
	type UpdateChannel,
	UpdateChannelSchema,
} from '../../config/updateChannel.js';
import { postComment } from '../../gadgets/pm/core/postComment.js';
import { postCommentDef } from '../../gadgets/pm/definitions.js';
import { createCLICommand } from '../../gadgets/shared/cliCommandFactory.js';

/**
 * Resolve the update channel for this run.
 *
 * Checks two sources in order:
 * 1. `CASCADE_UPDATE_CHANNEL` env var — injected into the subprocess env dict by
 *    `augmentProjectSecrets`. May be stripped by the claude subprocess chain.
 * 2. Channel file written to `/tmp/cascade-update-channel` by the worker process
 *    before the agent starts — survives subprocess env filtering.
 *
 * Absent/invalid in both sources → {@link DEFAULT_UPDATE_CHANNEL} (`both`). This
 * mirrors the sibling `create-pr-review` gate (`resolveEventPolicyFromEnv`): the
 * env var alone is not trusted under claude-code, which is the default engine and
 * is known to drop custom env vars from bash subprocesses (@anthropic-ai/claude-code
 * ≤ 2.1.185). Without the file fallback this gate would fail OPEN and post anyway.
 */
function resolveUpdateChannelFromEnv(): UpdateChannel {
	const envParsed = UpdateChannelSchema.safeParse(process.env[UPDATE_CHANNEL_ENV_VAR]);
	if (envParsed.success) return envParsed.data;

	try {
		const fileParsed = UpdateChannelSchema.safeParse(
			readFileSync(UPDATE_CHANNEL_FILE, 'utf-8').trim(),
		);
		if (fileParsed.success) return fileParsed.data;
	} catch {
		// File absent or unreadable → default
	}

	return DEFAULT_UPDATE_CHANNEL;
}

export default createCLICommand(postCommentDef, async (params) => {
	// Honor the update channel injected by the orchestrator. When PM posting is
	// disabled (scm-only / none), return a structured skip so the agent sees a
	// clear explanation rather than silently posting anyway.
	const channel = resolveUpdateChannelFromEnv();
	if (!isPmPostingEnabled(channel)) {
		return { skipped: true, reason: `PM posting disabled by update channel (${channel})` };
	}
	return postComment(params.workItemId as string, params.text as string);
});
