/**
 * ImapIntegration — resolves password-based IMAP/SMTP credentials from the DB
 * and scopes an ImapEmailProvider for the duration of the callback.
 */

import { getIntegrationCredentialOrNull } from '../../config/provider.js';
import { logger } from '../../utils/logging.js';
import { withEmailProvider } from '../context.js';
import type { EmailIntegration } from '../provider.js';
import { ImapEmailProvider } from './adapter.js';

export class ImapIntegration implements EmailIntegration {
	readonly type = 'imap';

	async withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
		const creds = await this.resolveCredentials(projectId);
		if (!creds) {
			return fn();
		}
		return withEmailProvider(new ImapEmailProvider(creds), fn);
	}

	async hasCredentials(projectId: string): Promise<boolean> {
		const creds = await this.resolveCredentials(projectId);
		return creds !== null;
	}

	private async resolveCredentials(projectId: string) {
		const [imapHost, imapPortStr, smtpHost, smtpPortStr, username, password] = await Promise.all([
			getIntegrationCredentialOrNull(projectId, 'email', 'imap_host'),
			getIntegrationCredentialOrNull(projectId, 'email', 'imap_port'),
			getIntegrationCredentialOrNull(projectId, 'email', 'smtp_host'),
			getIntegrationCredentialOrNull(projectId, 'email', 'smtp_port'),
			getIntegrationCredentialOrNull(projectId, 'email', 'username'),
			getIntegrationCredentialOrNull(projectId, 'email', 'password'),
		]);

		if (!imapHost || !imapPortStr || !smtpHost || !smtpPortStr || !username || !password) {
			return null;
		}

		const imapPort = Number.parseInt(imapPortStr, 10);
		const smtpPort = Number.parseInt(smtpPortStr, 10);

		if (Number.isNaN(imapPort) || Number.isNaN(smtpPort)) {
			logger.warn('Invalid IMAP/SMTP port in email credentials — skipping provider', {
				projectId,
				imapPort: imapPortStr,
				smtpPort: smtpPortStr,
			});
			return null;
		}

		return {
			authMethod: 'password' as const,
			imapHost,
			imapPort,
			smtpHost,
			smtpPort,
			username,
			password,
		};
	}
}
