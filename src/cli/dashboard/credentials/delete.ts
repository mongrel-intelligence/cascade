import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class CredentialsDelete extends DashboardCommand {
	static override description = 'Delete a credential.';

	static override args = {
		id: Args.integer({ description: 'Credential ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		yes: Flags.boolean({ description: 'Skip confirmation', char: 'y', default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(CredentialsDelete);

		if (!flags.yes) {
			this.error('Pass --yes to confirm deletion.');
		}

		try {
			await this.client.credentials.delete.mutate({ id: args.id });

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.log(`Deleted credential #${args.id}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
