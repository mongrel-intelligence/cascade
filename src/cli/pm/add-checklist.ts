import { Flags } from '@oclif/core';
import { addChecklist } from '../../gadgets/pm/core/addChecklist.js';
import { CredentialScopedCommand } from '../base.js';

export default class AddChecklist extends CredentialScopedCommand {
	static override description = 'Add a checklist with items to a work item.';

	static override flags = {
		workItemId: Flags.string({ description: 'The work item ID', required: true }),
		name: Flags.string({ description: 'Checklist name', required: true }),
		items: Flags.string({
			description: 'Checklist items (can be specified multiple times)',
			required: true,
			multiple: true,
		}),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(AddChecklist);
		const result = await addChecklist({
			workItemId: flags.workItemId,
			checklistName: flags.name,
			items: flags.items,
		});
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
