import { Args, Flags } from '@oclif/core';
import { createWorkItem } from '../../gadgets/pm/core/createWorkItem.js';
import { CredentialScopedCommand } from '../base.js';

export default class CreateWorkItem extends CredentialScopedCommand {
	static override description = 'Create a new work item in a container (list/project).';

	static override args = {
		containerId: Args.string({ description: 'The container ID (list or project)', required: true }),
	};

	static override flags = {
		title: Flags.string({ description: 'Work item title', required: true }),
		description: Flags.string({ description: 'Work item description (markdown supported)' }),
	};

	async execute(): Promise<void> {
		const { args, flags } = await this.parse(CreateWorkItem);
		const result = await createWorkItem({
			containerId: args.containerId,
			title: flags.title,
			description: flags.description,
		});
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
