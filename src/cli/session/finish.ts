import { Command, Flags } from '@oclif/core';
import { validateFinish } from '../../gadgets/session/core/finish.js';

export default class Finish extends Command {
	static override description =
		'Validate and signal session completion. Checks that all required work is done before finishing.';

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

		const result = await validateFinish({
			agentType: flags['agent-type'] ?? process.env.CASCADE_AGENT_TYPE ?? null,
			prCreated: flags['pr-created'],
			reviewSubmitted: flags['review-submitted'],
			hooks: {},
		});

		if (!result.valid) {
			this.log(JSON.stringify({ success: false, error: result.error }));
			this.exit(1);
		}

		this.log(JSON.stringify({ success: true, data: `Session ended: ${flags.comment}` }));
	}
}
