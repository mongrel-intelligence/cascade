import { Flags } from '@oclif/core';
import { updateChecklistItem } from '../../gadgets/pm/core/updateChecklistItem.js';
import { CredentialScopedCommand } from '../base.js';

export default class UpdateChecklistItem extends CredentialScopedCommand {
	static override description = 'Update a checklist item state on a work item.';

	static override flags = {
		workItemId: Flags.string({ description: 'The work item ID', required: true }),
		'check-item-id': Flags.string({ description: 'The checklist item ID', required: true }),
		state: Flags.string({
			description: 'The new state',
			required: true,
			options: ['complete', 'incomplete'],
		}),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(UpdateChecklistItem);
		const result = await updateChecklistItem(
			flags.workItemId,
			flags['check-item-id'],
			flags.state === 'complete',
		);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
