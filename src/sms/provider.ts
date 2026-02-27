/**
 * SmsProvider and SmsIntegration interfaces.
 *
 * SmsProvider — the runtime object that performs SMS operations
 *   for a specific auth method / vendor.
 *
 * SmsIntegration — knows how to resolve credentials for a project
 *   and scope an SmsProvider via AsyncLocalStorage.
 */

import type { SendSmsOptions, SendSmsResult } from './types.js';

export interface SmsProvider {
	readonly type: string; // 'twilio'
	sendSms(options: SendSmsOptions): Promise<SendSmsResult>;
}

export interface SmsIntegration {
	readonly type: string; // matches project_integrations.provider
	/** Resolve credentials from DB and run fn inside provider scope */
	withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T>;
	/** True if all required credentials are present */
	hasCredentials(projectId: string): Promise<boolean>;
}
