import { Flags } from '@oclif/core';
import { deleteChecklistItem } from '../../gadgets/pm/core/deleteChecklistItem.js';
import { CredentialScopedCommand } from '../base.js';

export default class DeleteChecklistItem extends CredentialScopedCommand {
	static override description = 'Delete a checklist item from a work item.';

	static override flags = {
		workItemId: Flags.string({ description: 'The work item ID', required: true }),
		'check-item-id': Flags.string({ description: 'The checklist item ID', required: true }),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(DeleteChecklistItem);
		const result = await deleteChecklistItem(flags.workItemId, flags['check-item-id']);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
