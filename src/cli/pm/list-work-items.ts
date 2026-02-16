import { Args } from '@oclif/core';
import { listWorkItems } from '../../gadgets/pm/core/listWorkItems.js';
import { CredentialScopedCommand } from '../base.js';

export default class ListWorkItems extends CredentialScopedCommand {
	static override description = 'List all work items in a container (list/project).';

	static override args = {
		containerId: Args.string({ description: 'The container ID (list or project)', required: true }),
	};

	async execute(): Promise<void> {
		const { args } = await this.parse(ListWorkItems);
		const result = await listWorkItems(args.containerId);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
