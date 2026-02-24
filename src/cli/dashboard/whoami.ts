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

			const detail: Record<string, { label: string }> = {
				name: { label: 'Name' },
				email: { label: 'Email' },
				role: { label: 'Role' },
				orgId: { label: 'Org' },
			};

			const data = user as unknown as Record<string, unknown>;

			if (data.effectiveOrgId && data.effectiveOrgId !== data.orgId) {
				detail.effectiveOrgId = { label: 'Effective Org' };
			}

			this.outputDetail(data, detail);
		} catch (err) {
			this.handleError(err);
		}
	}
}
