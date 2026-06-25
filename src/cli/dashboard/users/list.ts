import { DashboardCommand } from '../_shared/base.js';
import { formatDate } from '../_shared/format.js';

export default class UsersList extends DashboardCommand {
	static override description = 'List organization users.';

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(UsersList);

		try {
			const users = await this.client.users.list.query();

			const columns = [
				{ key: 'id', header: 'ID' },
				{ key: 'email', header: 'Email' },
				{ key: 'name', header: 'Name' },
				// Render the GLOBAL account role (`users.role`), not the per-org
				// membership `role` returned alongside it. The list is now
				// membership-based (`listOrgMembers`), whose per-org `role` can only
				// ever be 'member' | 'admin' — so printing it would mislabel
				// superadmins as 'admin'. `globalRole` restores correct superadmin
				// visibility and matches the web UI's interim choice (PR #1441 review).
				{ key: 'globalRole', header: 'Role' },
				{ key: 'createdAt', header: 'Created', format: formatDate },
			];

			this.outputFormatted(
				users as unknown as Record<string, unknown>[],
				columns,
				flags,
				users,
				'No users found. Create one with: cascade users create --email <email> --password <pass>',
			);
		} catch (err) {
			this.handleError(err);
		}
	}
}
