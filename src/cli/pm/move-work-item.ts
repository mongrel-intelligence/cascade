import { Flags } from '@oclif/core';
import { moveWorkItem } from '../../gadgets/pm/core/moveWorkItem.js';
import { CredentialScopedCommand } from '../base.js';

export default class MoveWorkItem extends CredentialScopedCommand {
	static override description = 'Move a work item to a different list or status.';

	static override flags = {
		workItemId: Flags.string({ description: 'The work item ID', required: true }),
		destination: Flags.string({ description: 'Target list ID or status name', required: true }),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(MoveWorkItem);
		const result = await moveWorkItem({
			workItemId: flags.workItemId,
			destination: flags.destination,
		});
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
