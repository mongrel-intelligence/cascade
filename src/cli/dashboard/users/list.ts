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

			if (flags.json) {
				this.outputJson(users);
				return;
			}

			this.outputTable(users as unknown as Record<string, unknown>[], [
				{ key: 'id', header: 'ID' },
				{ key: 'email', header: 'Email' },
				{ key: 'name', header: 'Name' },
				{ key: 'role', header: 'Role' },
				{ key: 'createdAt', header: 'Created', format: formatDate },
			]);
		} catch (err) {
			this.handleError(err);
		}
	}
}
