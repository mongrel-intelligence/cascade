import { Args, Flags } from '@oclif/core';
import { updateWorkItem } from '../../gadgets/pm/core/updateWorkItem.js';
import { CredentialScopedCommand } from '../base.js';

export default class UpdateWorkItem extends CredentialScopedCommand {
	static override description = 'Update a work item title, description, or labels.';

	static override args = {
		workItemId: Args.string({ description: 'The work item ID', required: true }),
	};

	static override flags = {
		title: Flags.string({ description: 'New title' }),
		description: Flags.string({ description: 'New description (markdown supported)' }),
		'add-label-ids': Flags.string({
			description: 'Comma-separated label IDs to add',
		}),
	};

	async execute(): Promise<void> {
		const { args, flags } = await this.parse(UpdateWorkItem);
		const result = await updateWorkItem({
			workItemId: args.workItemId,
			title: flags.title,
			description: flags.description,
			addLabelIds: flags['add-label-ids']?.split(','),
		});
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
