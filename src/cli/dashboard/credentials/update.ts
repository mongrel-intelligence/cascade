import { Args, Flags } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class CredentialsUpdate extends DashboardCommand {
	static override description = 'Update a credential.';

	static override args = {
		id: Args.integer({ description: 'Credential ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
		name: Flags.string({ description: 'Credential name' }),
		value: Flags.string({ description: 'Credential value' }),
		default: Flags.boolean({ description: 'Set as org default', allowNo: true }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(CredentialsUpdate);

		try {
			await this.client.credentials.update.mutate({
				id: args.id,
				name: flags.name,
				value: flags.value,
				isDefault: flags.default,
			});

			if (flags.json) {
				this.outputJson({ ok: true });
				return;
			}

			this.log(`Updated credential #${args.id}`);
		} catch (err) {
			this.handleError(err);
		}
	}
}
