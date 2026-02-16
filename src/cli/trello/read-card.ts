import { Args, Flags } from '@oclif/core';
import { readCard } from '../../gadgets/trello/core/readCard.js';
import { CredentialScopedCommand } from '../base.js';

export default class ReadCard extends CredentialScopedCommand {
	static override description =
		'Read a Trello card with its title, description, comments, checklists, and attachments.';

	static override args = {
		cardId: Args.string({ description: 'The Trello card ID', required: true }),
	};

	static override flags = {
		'include-comments': Flags.boolean({
			description: 'Include card comments in the response',
			default: true,
			allowNo: true,
		}),
	};

	async execute(): Promise<void> {
		const { args, flags } = await this.parse(ReadCard);
		const result = await readCard(args.cardId, flags['include-comments']);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
