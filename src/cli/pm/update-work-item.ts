import { readFileSync } from 'node:fs';
import { Flags } from '@oclif/core';
import { updateWorkItem } from '../../gadgets/pm/core/updateWorkItem.js';
import { CredentialScopedCommand } from '../base.js';

export default class UpdateWorkItem extends CredentialScopedCommand {
	static override description = 'Update a work item title, description, or labels.';

	static override flags = {
		workItemId: Flags.string({ description: 'The work item ID', required: true }),
		title: Flags.string({ description: 'New title' }),
		description: Flags.string({ description: 'New description (markdown supported)' }),
		'description-file': Flags.string({
			description: 'Read description from file (use - for stdin)',
		}),
		'add-label-ids': Flags.string({
			description: 'Comma-separated label IDs to add',
		}),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(UpdateWorkItem);
		let description = flags.description;
		if (flags['description-file']) {
			description =
				flags['description-file'] === '-'
					? readFileSync(0, 'utf-8')
					: readFileSync(flags['description-file'], 'utf-8');
		}
		const result = await updateWorkItem({
			workItemId: flags.workItemId,
			title: flags.title,
			description,
			addLabelIds: flags['add-label-ids']?.split(','),
		});
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
