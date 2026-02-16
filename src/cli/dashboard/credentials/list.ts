import { DashboardCommand } from '../_shared/base.js';
import { formatBoolean } from '../_shared/format.js';

export default class CredentialsList extends DashboardCommand {
	static override description = 'List organization credentials (values masked).';

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(CredentialsList);

		try {
			const creds = await this.client.credentials.list.query();

			if (flags.json) {
				this.outputJson(creds);
				return;
			}

			this.outputTable(creds as unknown as Record<string, unknown>[], [
				{ key: 'id', header: 'ID' },
				{ key: 'name', header: 'Name' },
				{ key: 'envVarKey', header: 'Key' },
				{ key: 'value', header: 'Value (masked)' },
				{ key: 'isDefault', header: 'Default', format: formatBoolean },
			]);
		} catch (err) {
			this.handleError(err);
		}
	}
}
