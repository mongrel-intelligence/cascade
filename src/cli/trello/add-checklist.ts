import { Args, Command, Flags } from '@oclif/core';
import { addChecklist } from '../../gadgets/trello/core/addChecklist.js';

export default class AddChecklist extends Command {
	static override description = 'Add a checklist with items to a Trello card.';

	static override args = {
		cardId: Args.string({ description: 'The Trello card ID', required: true }),
	};

	static override flags = {
		name: Flags.string({ description: 'Checklist name', required: true }),
		items: Flags.string({
			description: 'Checklist items (can be specified multiple times)',
			required: true,
			multiple: true,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(AddChecklist);
		const result = await addChecklist({
			cardId: args.cardId,
			checklistName: flags.name,
			items: flags.items,
		});
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
