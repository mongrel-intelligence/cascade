/**
 * TwilioIntegration — resolves Twilio credentials from the DB
 * and scopes a TwilioSmsProvider for the duration of the callback.
 */

import { getIntegrationCredentialOrNull } from '../../config/provider.js';
import { withSmsProvider } from '../context.js';
import type { SmsIntegration } from '../provider.js';
import { TwilioSmsProvider } from './adapter.js';

export class TwilioIntegration implements SmsIntegration {
	readonly type = 'twilio';

	async withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
		const creds = await this.resolveCredentials(projectId);
		if (!creds) {
			return fn();
		}
		return withSmsProvider(new TwilioSmsProvider(creds), fn);
	}

	async hasCredentials(projectId: string): Promise<boolean> {
		const creds = await this.resolveCredentials(projectId);
		return creds !== null;
	}

	private async resolveCredentials(projectId: string) {
		const [accountSid, authToken, phoneNumber] = await Promise.all([
			getIntegrationCredentialOrNull(projectId, 'sms', 'account_sid'),
			getIntegrationCredentialOrNull(projectId, 'sms', 'auth_token'),
			getIntegrationCredentialOrNull(projectId, 'sms', 'phone_number'),
		]);

		if (!accountSid || !authToken || !phoneNumber) {
			return null;
		}

		return { accountSid, authToken, phoneNumber };
	}
}
