import { Args, Command, Flags } from '@oclif/core';
import { createPRReview } from '../../gadgets/github/core/createPRReview.js';

export default class CreatePRReviewCommand extends Command {
	static override description = 'Submit a code review on a GitHub pull request.';

	static override args = {
		prNumber: Args.integer({ description: 'The pull request number', required: true }),
	};

	static override flags = {
		owner: Flags.string({ description: 'Repository owner', required: true }),
		repo: Flags.string({ description: 'Repository name', required: true }),
		event: Flags.string({
			description: 'Review action',
			required: true,
			options: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'],
		}),
		body: Flags.string({ description: 'Review summary (markdown supported)', required: true }),
		comments: Flags.string({
			description: 'Inline comments as JSON array: [{"path":"file","line":1,"body":"comment"}]',
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(CreatePRReviewCommand);

		let comments: Array<{ path: string; line?: number; body: string }> | undefined;
		if (flags.comments) {
			comments = JSON.parse(flags.comments) as Array<{
				path: string;
				line?: number;
				body: string;
			}>;
		}

		const result = await createPRReview({
			owner: flags.owner,
			repo: flags.repo,
			prNumber: args.prNumber,
			event: flags.event as 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
			body: flags.body,
			comments,
		});
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
