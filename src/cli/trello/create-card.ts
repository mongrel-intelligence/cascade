import { Args, Flags } from '@oclif/core';
import { createCard } from '../../gadgets/trello/core/createCard.js';
import { CredentialScopedCommand } from '../base.js';

export default class CreateCard extends CredentialScopedCommand {
	static override description = 'Create a new Trello card in a specific list.';

	static override args = {
		listId: Args.string({ description: 'The Trello list ID', required: true }),
	};

	static override flags = {
		title: Flags.string({ description: 'Card title', required: true }),
		description: Flags.string({ description: 'Card description (markdown supported)' }),
	};

	async execute(): Promise<void> {
		const { args, flags } = await this.parse(CreateCard);
		const result = await createCard({
			listId: args.listId,
			title: flags.title,
			description: flags.description,
		});
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
