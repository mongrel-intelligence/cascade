import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';
import { confirm } from '../_shared/confirm.js';

export default class UsersRemoveFromOrg extends DashboardCommand {
	static override description =
		'Remove a user from the current organization (drops only the membership; the account and other organizations are unaffected).';

	static override examples = ['<%= config.bin %> users remove-from-org 0a1b2c3d-...'];

	static override args = {
		id: Args.string({
			description: 'User ID (UUID) to remove from this organization',
			required: true,
		}),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		yes: Flags.boolean({ description: 'Skip confirmation', char: 'y', default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(UsersRemoveFromOrg);

		await confirm(`Remove user ${args.id} from this organization?`, flags.yes);

		try {
			const result = await this.withSpinner('Removing user from organization...', () =>
				this.client.users.removeFromOrg.mutate({ userId: args.id }),
			);

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.success(`Removed user ${args.id} from this organization`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
