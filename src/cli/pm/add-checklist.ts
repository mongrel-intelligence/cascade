import { Args, Flags } from '@oclif/core';
import { addChecklist } from '../../gadgets/pm/core/addChecklist.js';
import { CredentialScopedCommand } from '../base.js';

export default class AddChecklist extends CredentialScopedCommand {
	static override description = 'Add a checklist with items to a work item.';

	static override args = {
		workItemId: Args.string({ description: 'The work item ID', required: true }),
	};

	static override flags = {
		name: Flags.string({ description: 'Checklist name', required: true }),
		items: Flags.string({
			description: 'Checklist items (can be specified multiple times)',
			required: true,
			multiple: true,
		}),
	};

	async execute(): Promise<void> {
		const { args, flags } = await this.parse(AddChecklist);
		const result = await addChecklist({
			workItemId: args.workItemId,
			checklistName: flags.name,
			items: flags.items,
		});
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
