/**
 * EmailProvider and EmailIntegration interfaces.
 *
 * EmailProvider — the runtime object that performs email operations
 *   (IMAP reads, SMTP/API sends) for a specific auth method.
 *
 * EmailIntegration — knows how to resolve credentials for a project
 *   and scope an EmailProvider via AsyncLocalStorage.
 */

import type {
	EmailMessage,
	EmailSearchCriteria,
	EmailSummary,
	ReplyEmailOptions,
	SendEmailOptions,
	SendEmailResult,
} from './types.js';

export interface EmailProvider {
	readonly type: string; // 'imap' | 'gmail'
	searchEmails(
		folder: string,
		criteria: EmailSearchCriteria,
		maxResults: number,
	): Promise<EmailSummary[]>;
	readEmail(folder: string, uid: number): Promise<EmailMessage>;
	sendEmail(options: SendEmailOptions): Promise<SendEmailResult>;
	replyToEmail(options: ReplyEmailOptions): Promise<SendEmailResult>;
	markEmailAsSeen(folder: string, uid: number): Promise<void>;
}

export interface EmailIntegration {
	readonly type: string; // matches project_integrations.provider
	/** Resolve credentials from DB and run fn inside provider scope */
	withCredentials<T>(projectId: string, fn: () => Promise<T>): Promise<T>;
	/** True if all required credentials are present */
	hasCredentials(projectId: string): Promise<boolean>;
}
