import { Command, Flags } from '@oclif/core';
import { readCompletionEvidence } from '../../backends/completion.js';
import { validateFinish } from '../../gadgets/session/core/finish.js';
import { writePushedChangesSidecar } from '../../gadgets/session/core/finish.js';
import { finishDef } from '../../gadgets/session/definitions.js';
import type { SessionHooks } from '../../gadgets/sessionState.js';
import {
	PR_SIDECAR_ENV_VAR,
	PUSHED_CHANGES_SIDECAR_ENV_VAR,
	REVIEW_SIDECAR_ENV_VAR,
} from '../../gadgets/sessionState.js';

function readFinishHooksFromEnv(): SessionHooks {
	const raw = process.env.CASCADE_FINISH_HOOKS;
	if (!raw) return {};

	try {
		return JSON.parse(raw) as SessionHooks;
	} catch {
		return {};
	}
}

export default class Finish extends Command {
	static override description = finishDef.description;

	static override flags = {
		'agent-type': Flags.string({ description: 'The agent type running the session' }),
		'pr-created': Flags.boolean({
			description: 'Whether a PR was created in this session',
			default: false,
		}),
		'review-submitted': Flags.boolean({
			description: 'Whether a review was submitted in this session',
			default: false,
		}),
		comment: Flags.string({
			description: 'Summary of what was accomplished',
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Finish);
		const hooks = readFinishHooksFromEnv();
		const evidence = readCompletionEvidence({
			prSidecarPath: process.env[PR_SIDECAR_ENV_VAR],
			reviewSidecarPath: process.env[REVIEW_SIDECAR_ENV_VAR],
		});

		const result = await validateFinish({
			agentType: flags['agent-type'] ?? process.env.CASCADE_AGENT_TYPE ?? null,
			prCreated: flags['pr-created'] || evidence.hasAuthoritativePR,
			reviewSubmitted: flags['review-submitted'] || evidence.hasAuthoritativeReview,
			hooks,
			initialHeadSha: process.env.CASCADE_INITIAL_HEAD_SHA ?? null,
		});

		if (!result.valid) {
			this.log(JSON.stringify({ success: false, error: result.error }));
			this.exit(1);
		}

		if (hooks.requiresPushedChanges) {
			writePushedChangesSidecar(process.env[PUSHED_CHANGES_SIDECAR_ENV_VAR]);
		}

		this.log(JSON.stringify({ success: true, data: `Session ended: ${flags.comment}` }));
	}
}
