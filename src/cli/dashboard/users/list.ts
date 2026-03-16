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
				{ key: 'role', header: 'Role' },
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
