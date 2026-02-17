import { readFileSync } from 'node:fs';
import { Flags } from '@oclif/core';
import { createWorkItem } from '../../gadgets/pm/core/createWorkItem.js';
import { CredentialScopedCommand } from '../base.js';

export default class CreateWorkItem extends CredentialScopedCommand {
	static override description = 'Create a new work item in a container (list/project).';

	static override flags = {
		containerId: Flags.string({
			description: 'The container ID (list or project)',
			required: true,
		}),
		title: Flags.string({ description: 'Work item title', required: true }),
		description: Flags.string({ description: 'Work item description (markdown supported)' }),
		'description-file': Flags.string({
			description: 'Read description from file (use - for stdin)',
		}),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(CreateWorkItem);
		let description = flags.description;
		if (flags['description-file']) {
			description =
				flags['description-file'] === '-'
					? readFileSync(0, 'utf-8')
					: readFileSync(flags['description-file'], 'utf-8');
		}
		const result = await createWorkItem({
			containerId: flags.containerId,
			title: flags.title,
			description,
		});
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
