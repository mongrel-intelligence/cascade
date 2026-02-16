import { DashboardCommand } from './_shared/base.js';

export default class Whoami extends DashboardCommand {
	static override description = 'Show current logged-in user.';

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(Whoami);

		try {
			const user = await this.client.auth.me.query();

			if (flags.json) {
				this.outputJson(user);
				return;
			}

			this.outputDetail(user as unknown as Record<string, unknown>, {
				name: { label: 'Name' },
				email: { label: 'Email' },
				role: { label: 'Role' },
				orgId: { label: 'Org' },
			});
		} catch (err) {
			this.handleError(err);
		}
	}
}
