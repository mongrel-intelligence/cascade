import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class UsersDelete extends DashboardCommand {
	static override description = 'Delete a user.';

	static override args = {
		id: Args.string({ description: 'User ID (UUID)', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		yes: Flags.boolean({ description: 'Skip confirmation', char: 'y', default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(UsersDelete);

		if (!flags.yes) {
			this.error('Pass --yes to confirm deletion.');
		}

		try {
			await this.client.users.delete.mutate({ id: args.id });

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.log(`Deleted user ${args.id}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
