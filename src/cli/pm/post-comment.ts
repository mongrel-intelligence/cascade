import { readFileSync } from 'node:fs';
import { Flags } from '@oclif/core';
import { postComment } from '../../gadgets/pm/core/postComment.js';
import { CredentialScopedCommand } from '../base.js';

export default class PostComment extends CredentialScopedCommand {
	static override description = 'Post a comment to a work item.';

	static override flags = {
		workItemId: Flags.string({ description: 'The work item ID', required: true }),
		text: Flags.string({ description: 'The comment text (supports markdown)' }),
		'text-file': Flags.string({
			description: 'Read comment text from file (use - for stdin)',
		}),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(PostComment);
		let text = flags.text;
		if (flags['text-file']) {
			text =
				flags['text-file'] === '-'
					? readFileSync(0, 'utf-8')
					: readFileSync(flags['text-file'], 'utf-8');
		}
		if (!text) {
			this.error('Either --text or --text-file is required');
		}
		const result = await postComment(flags.workItemId, text);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
