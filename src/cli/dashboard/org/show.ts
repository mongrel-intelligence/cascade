import { DashboardCommand } from '../_shared/base.js';

export default class OrgShow extends DashboardCommand {
	static override description = 'Show organization info.';

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(OrgShow);

		try {
			const org = await this.client.organization.get.query();

			if (flags.json) {
				this.outputJson(org);
				return;
			}

			if (!org) {
				this.log('Organization not found.');
				return;
			}

			this.outputDetail(org as unknown as Record<string, unknown>, {
				id: { label: 'ID' },
				name: { label: 'Name' },
			});
		} catch (err) {
			this.handleError(err);
		}
	}
}
