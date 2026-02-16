import { Flags } from '@oclif/core';
import { postComment } from '../../gadgets/pm/core/postComment.js';
import { CredentialScopedCommand } from '../base.js';

export default class PostComment extends CredentialScopedCommand {
	static override description = 'Post a comment to a work item.';

	static override flags = {
		workItemId: Flags.string({ description: 'The work item ID', required: true }),
		text: Flags.string({ description: 'The comment text (supports markdown)', required: true }),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(PostComment);
		const result = await postComment(flags.workItemId, flags.text);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
