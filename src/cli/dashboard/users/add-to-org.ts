import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class UsersAddToOrg extends DashboardCommand {
	static override description =
		'Add an existing user account to the current organization with a per-org role.';

	static override examples = [
		'<%= config.bin %> users add-to-org --email alice@example.com',
		'<%= config.bin %> users add-to-org --email alice@example.com --role admin',
	];

	static override flags = {
		...DashboardCommand.baseFlags,
		email: Flags.string({ description: 'Email of the existing account to add', required: true }),
		role: Flags.string({
			description: 'Per-org role to grant (member, admin)',
			options: ['member', 'admin'],
			default: 'member',
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(UsersAddToOrg);

		try {
			const result = await this.withSpinner('Adding user to organization...', () =>
				this.client.users.addExistingUserToOrg.mutate({
					email: flags.email,
					role: flags.role as 'member' | 'admin' | undefined,
				}),
			);

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			if (result.alreadyMember) {
				this.success(`Updated ${result.email}'s role to ${result.role} in this organization`);
			} else {
				this.success(`Added ${result.email} to this organization as ${result.role}`);
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
