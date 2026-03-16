import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class OrgUpdate extends DashboardCommand {
	static override description = 'Update organization info.';

	static override flags = {
		...DashboardCommand.baseFlags,
		name: Flags.string({ description: 'Organization name', required: true }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(OrgUpdate);

		try {
			await this.withSpinner('Updating organization...', () =>
				this.client.organization.update.mutate({ name: flags.name }),
			);

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.success(`Updated organization name to '${flags.name}'`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
