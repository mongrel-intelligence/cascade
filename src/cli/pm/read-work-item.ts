import { Flags } from '@oclif/core';
import { readWorkItem } from '../../gadgets/pm/core/readWorkItem.js';
import { CredentialScopedCommand } from '../base.js';

export default class ReadWorkItem extends CredentialScopedCommand {
	static override description =
		'Read a work item with its title, description, comments, checklists, and attachments.';

	static override flags = {
		workItemId: Flags.string({ description: 'The work item ID', required: true }),
		'include-comments': Flags.boolean({
			description: 'Include comments in the response',
			default: true,
			allowNo: true,
		}),
	};

	async execute(): Promise<void> {
		const { flags } = await this.parse(ReadWorkItem);
		const result = await readWorkItem(flags.workItemId, flags['include-comments']);
		this.log(JSON.stringify({ success: true, data: result }));
	}
}
