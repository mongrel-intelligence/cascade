/**
 * Email credentials for IMAP/SMTP connections.
 */
export interface EmailCredentials {
	imapHost: string;
	imapPort: number;
	smtpHost: string;
	smtpPort: number;
	username: string;
	password: string;
}

/**
 * Search criteria for IMAP email search.
 */
export interface EmailSearchCriteria {
	from?: string;
	to?: string;
	subject?: string;
	body?: string;
	since?: string; // YYYY-MM-DD
	before?: string; // YYYY-MM-DD
	unseen?: boolean;
}

/**
 * Email message summary (from search results).
 */
export interface EmailSummary {
	uid: number;
	date: Date;
	from: string;
	to: string[];
	subject: string;
	snippet: string;
}

/**
 * Full email message with body.
 */
export interface EmailMessage {
	uid: number;
	messageId: string;
	date: Date;
	from: string;
	to: string[];
	cc: string[];
	subject: string;
	textBody: string;
	htmlBody?: string;
	attachments: EmailAttachment[];
	inReplyTo?: string;
	references: string[];
}

/**
 * Email attachment metadata.
 */
export interface EmailAttachment {
	filename: string;
	contentType: string;
	size: number;
}

/**
 * Options for sending an email.
 */
export interface SendEmailOptions {
	to: string[];
	subject: string;
	body: string;
	html?: string;
	cc?: string[];
	bcc?: string[];
}

/**
 * Result of sending an email.
 */
export interface SendEmailResult {
	messageId: string;
	accepted: string[];
	rejected: string[];
}

/**
 * Options for replying to an email.
 */
export interface ReplyEmailOptions {
	folder: string;
	uid: number;
	body: string;
	replyAll: boolean;
}
