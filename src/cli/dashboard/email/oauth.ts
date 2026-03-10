import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class EmailOAuth extends DashboardCommand {
	static override description =
		'Authenticate Gmail via OAuth. Opens browser and runs local callback server.';

	static override args = {
		projectId: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		port: Flags.integer({
			description: 'Local callback server port',
			default: 8085,
		}),
	};

	async run(): Promise<void> {
		this.error('Gmail OAuth is no longer supported. Email integration has been removed.');
	}
}
