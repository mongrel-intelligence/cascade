import { Args } from '@oclif/core';
import { listCards } from '../../gadgets/trello/core/listCards.js';
import { CredentialScopedCommand } from '../base.js';

export default class ListCards extends CredentialScopedCommand {
	static override description = 'List all cards on a Trello list.';

	static override args = {
		listId: Args.string({ description: 'The Trello list ID', required: true }),
	};

	async execute(): Promise<void> {
		const { args } = await this.parse(ListCards);
		const result = await listCards(args.listId);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
