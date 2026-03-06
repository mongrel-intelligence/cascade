import { Args } from '@oclif/core';
import { DashboardCommand } from '../_shared/base.js';

export default class EmailVerify extends DashboardCommand {
	static override description = 'Verify email integration connection for a project.';

	static override args = {
		projectId: Args.string({ description: 'Project ID', required: true }),
	};

	static override flags = {
		...DashboardCommand.baseFlags,
	};

	private async verifyGmail(credMap: Map<string, number>, jsonOutput: boolean): Promise<void> {
		const orgCredentials = await this.client.credentials.list.query();
		const clientIdCred = orgCredentials.find(
			(c: { envVarKey: string }) => c.envVarKey === 'GOOGLE_OAUTH_CLIENT_ID',
		) as { id: number } | undefined;
		const clientSecretCred = orgCredentials.find(
			(c: { envVarKey: string }) => c.envVarKey === 'GOOGLE_OAUTH_CLIENT_SECRET',
		) as { id: number } | undefined;

		const refreshTokenCredId = credMap.get('gmail_refresh_token');
		const gmailEmailCredId = credMap.get('gmail_email');

		if (!clientIdCred || !clientSecretCred) {
			this.error('Google OAuth credentials not configured at org level.');
		}

		if (!refreshTokenCredId || !gmailEmailCredId) {
			this.error('Gmail credentials not linked to project. Run "cascade email oauth" first.');
		}

		const result = await this.client.integrationsDiscovery.verifyGmail.mutate({
			clientIdCredentialId: clientIdCred.id,
			clientSecretCredentialId: clientSecretCred.id,
			refreshTokenCredentialId: refreshTokenCredId,
			gmailEmailCredentialId: gmailEmailCredId,
		});

		if (jsonOutput) {
			this.outputJson(result);
			return;
		}

		this.log(`Gmail connection verified for: ${result.email}`);
	}

	private async verifyImap(credMap: Map<string, number>, jsonOutput: boolean): Promise<void> {
		const hostCredId = credMap.get('imap_host');
		const portCredId = credMap.get('imap_port');
		const usernameCredId = credMap.get('username');
		const passwordCredId = credMap.get('password');

		if (!hostCredId || !portCredId || !usernameCredId || !passwordCredId) {
			this.error('IMAP credentials not fully configured for project.');
		}

		const result = await this.client.integrationsDiscovery.verifyImap.mutate({
			hostCredentialId: hostCredId,
			portCredentialId: portCredId,
			usernameCredentialId: usernameCredId,
			passwordCredentialId: passwordCredId,
		});

		if (jsonOutput) {
			this.outputJson(result);
			return;
		}

		this.log(`IMAP connection verified for: ${result.email}`);
	}

	async run(): Promise<void> {
		const { args, flags } = await this.parse(EmailVerify);

		try {
			const integrations = await this.client.projects.integrations.list.query({
				projectId: args.projectId,
			});

			const emailIntegration = integrations.find(
				(i: { category: string }) => i.category === 'email',
			) as { provider: string } | undefined;

			if (!emailIntegration) {
				this.error('No email integration configured for this project.');
			}

			const credentials = await this.client.projects.integrationCredentials.list.query({
				projectId: args.projectId,
				category: 'email',
			});

			const credMap = new Map<string, number>();
			for (const c of credentials as Array<{ role: string; credentialId: number }>) {
				credMap.set(c.role, c.credentialId);
			}

			if (emailIntegration.provider === 'gmail') {
				await this.verifyGmail(credMap, flags.json);
			} else if (emailIntegration.provider === 'imap') {
				await this.verifyImap(credMap, flags.json);
			} else {
				this.error(`Unknown email provider: ${emailIntegration.provider}`);
			}
		} catch (err) {
			this.handleError(err);
		}
	}
}
