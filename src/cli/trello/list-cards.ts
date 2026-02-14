import { Args, Command } from '@oclif/core';
import { listCards } from '../../gadgets/trello/core/listCards.js';

export default class ListCards extends Command {
	static override description = 'List all cards on a Trello list.';

	static override args = {
		listId: Args.string({ description: 'The Trello list ID', required: true }),
	};

	async run(): Promise<void> {
		const { args } = await this.parse(ListCards);
		const result = await listCards(args.listId);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
