import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class UsersUpdate extends DashboardCommand {
	static override description = 'Update a user.';

	static override args = {
		id: Args.string({ description: 'User ID (UUID)', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		name: Flags.string({ description: 'User display name' }),
		email: Flags.string({ description: 'User email address' }),
		role: Flags.string({
			description: 'User role (member, admin, superadmin)',
			options: ['member', 'admin', 'superadmin'],
		}),
		password: Flags.string({ description: 'New password' }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(UsersUpdate);

		try {
			await this.withSpinner('Updating user...', () =>
				this.client.users.update.mutate({
					id: args.id,
					name: flags.name,
					email: flags.email,
					role: flags.role as 'member' | 'admin' | 'superadmin' | undefined,
					password: flags.password,
				}),
			);

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.success(`Updated user ${args.id}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
