import { Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class CredentialsCreate extends DashboardCommand {
	static override description = 'Create a new credential.';

	static override flags = {
		...DashboardCommand.baseFlags,
		name: Flags.string({ description: 'Credential name', required: true }),
		key: Flags.string({
			description: 'Environment variable key (e.g. GITHUB_TOKEN_IMPLEMENTER)',
			required: true,
		}),
		value: Flags.string({ description: 'Credential value', required: true }),
		default: Flags.boolean({ description: 'Set as org default', default: false }),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(CredentialsCreate);

		try {
			const result = await this.client.credentials.create.mutate({
				name: flags.name,
				envVarKey: flags.key,
				value: flags.value,
				isDefault: flags.default,
			});

			if (flags.json) {
				this.outputJson(result);
				return;
			}

			this.log(`Created credential: ${flags.name} (${flags.key})`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
