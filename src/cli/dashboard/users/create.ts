import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class UsersCreate extends DashboardCommand {
	static override description = 'Create a new user.';

	static override flags = {
		...DashboardCommand.baseFlags,
		email: Flags.string({ description: 'User email address', required: true }),
		password: Flags.string({ description: 'User password', required: true }),
		name: Flags.string({ description: 'User display name', required: true }),
		role: Flags.string({
			description: 'User role (member, admin, superadmin)',
			options: ['member', 'admin', 'superadmin'],
			default: 'member',
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(UsersCreate);

		try {
			const result = await this.withSpinner('Creating user...', () =>
				this.client.users.create.mutate({
					email: flags.email,
					password: flags.password,
					name: flags.name,
					role: flags.role as 'member' | 'admin' | 'superadmin' | undefined,
				}),
			);

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.success(`Created user '${flags.name}' (${flags.email}), role: ${flags.role}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
