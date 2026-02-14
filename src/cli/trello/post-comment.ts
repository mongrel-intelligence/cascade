import { Args, Command, Flags } from '@oclif/core';
import { postComment } from '../../gadgets/trello/core/postComment.js';

export default class PostComment extends Command {
	static override description = 'Post a comment to a Trello card.';

	static override args = {
		cardId: Args.string({ description: 'The Trello card ID', required: true }),
	};

	static override flags = {
		text: Flags.string({ description: 'The comment text (supports markdown)', required: true }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(PostComment);
		const result = await postComment(args.cardId, flags.text);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
