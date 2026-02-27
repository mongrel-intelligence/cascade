/**
 * GmailIntegration — resolves OAuth credentials from the DB, exchanges a refresh
 * token for an access token, and scopes a GmailEmailProvider for the callback.
 */

import { getIntegrationCredentialOrNull, getOrgCredential } from '../../config/provider.js';
import { logger } from '../../utils/logging.js';
import { withEmailProvider } from '../context.js';
import type { EmailIntegration } from '../provider.js';
import { GmailEmailProvider } from './adapter.js';
import { getGmailAccessToken } from './oauth.js';

// Gmail IMAP/SMTP server constants
const GMAIL_IMAP_HOST = 'imap.gmail.com';
const GMAIL_IMAP_PORT = 993;
const GMAIL_SMTP_HOST = 'smtp.gmail.com';
const GMAIL_SMTP_PORT = 465;

export class GmailIntegration implements EmailIntegration {
	readonly type = 'gmail';

	async withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
		const creds = await this.resolveCredentials(projectId);
		if (!creds) {
			return fn();
		}
		return withEmailProvider(new GmailEmailProvider(creds), fn);
	}

	async hasCredentials(projectId: string): Promise<boolean> {
		const creds = await this.resolveCredentials(projectId);
		return creds !== null;
	}

	private async resolveCredentials(projectId: string) {
		const [gmailEmail, refreshToken] = await Promise.all([
			getIntegrationCredentialOrNull(projectId, 'email', 'gmail_email'),
			getIntegrationCredentialOrNull(projectId, 'email', 'gmail_refresh_token'),
		]);

		if (!gmailEmail || !refreshToken) {
			logger.debug('Gmail credentials not found for project', { projectId });
			return null;
		}

		const [clientId, clientSecret] = await Promise.all([
			getOrgCredential(projectId, 'GOOGLE_OAUTH_CLIENT_ID'),
			getOrgCredential(projectId, 'GOOGLE_OAUTH_CLIENT_SECRET'),
		]);

		if (!clientId || !clientSecret) {
			logger.warn('Google OAuth client credentials not found at org level', { projectId });
			return null;
		}

		try {
			const accessToken = await getGmailAccessToken(
				clientId,
				clientSecret,
				refreshToken,
				gmailEmail,
			);

			return {
				authMethod: 'oauth' as const,
				imapHost: GMAIL_IMAP_HOST,
				imapPort: GMAIL_IMAP_PORT,
				smtpHost: GMAIL_SMTP_HOST,
				smtpPort: GMAIL_SMTP_PORT,
				email: gmailEmail,
				accessToken,
			};
		} catch (error) {
			logger.error('Failed to get Gmail access token', {
				projectId,
				email: gmailEmail,
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}
}
