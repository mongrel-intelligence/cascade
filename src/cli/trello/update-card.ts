import { Args, Command, Flags } from '@oclif/core';
import { updateCard } from '../../gadgets/trello/core/updateCard.js';

export default class UpdateCard extends Command {
	static override description = 'Update a Trello card title, description, or labels.';

	static override args = {
		cardId: Args.string({ description: 'The Trello card ID', required: true }),
	};

	static override flags = {
		title: Flags.string({ description: 'New card title' }),
		description: Flags.string({ description: 'New card description (markdown supported)' }),
		'add-label-ids': Flags.string({
			description: 'Comma-separated label IDs to add',
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(UpdateCard);
		const result = await updateCard({
			cardId: args.cardId,
			title: flags.title,
			description: flags.description,
			addLabelIds: flags['add-label-ids']?.split(','),
		});
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
