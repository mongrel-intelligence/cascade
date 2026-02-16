import { Args, Flags } from '@oclif/core';
import { updateChecklistItem } from '../../gadgets/trello/core/updateChecklistItem.js';
import { CredentialScopedCommand } from '../base.js';

export default class UpdateChecklistItem extends CredentialScopedCommand {
	static override description = 'Update a checklist item state on a Trello card.';

	static override args = {
		cardId: Args.string({ description: 'The Trello card ID', required: true }),
	};

	static override flags = {
		'check-item-id': Flags.string({ description: 'The checklist item ID', required: true }),
		state: Flags.string({
			description: 'The new state',
			required: true,
			options: ['complete', 'incomplete'],
		}),
	};

	async execute(): Promise<void> {
		const { args, flags } = await this.parse(UpdateChecklistItem);
		const result = await updateChecklistItem(
			args.cardId,
			flags['check-item-id'],
			flags.state as 'complete' | 'incomplete',
		);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
