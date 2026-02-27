/**
 * ImapEmailProvider — EmailProvider backed by IMAP (read) + nodemailer SMTP (send).
 *
 * Used for standard password-authenticated email accounts.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { logger } from '../../utils/logging.js';
import type { EmailProvider } from '../provider.js';
import type {
	EmailMessage,
	EmailSearchCriteria,
	EmailSummary,
	PasswordEmailCredentials,
	ReplyEmailOptions,
	SendEmailOptions,
	SendEmailResult,
} from '../types.js';
import {
	buildSearchQuery,
	createImapClient,
	extractAttachments,
	parseAddress,
	parseAddresses,
	parseEmailBody,
	parseThreadingHeaders,
} from './utils.js';

export class ImapEmailProvider implements EmailProvider {
	readonly type = 'imap';

	constructor(private readonly creds: PasswordEmailCredentials) {}

	private buildSmtpTransport(): Transporter {
		return nodemailer.createTransport({
			host: this.creds.smtpHost,
			port: this.creds.smtpPort,
			secure: this.creds.smtpPort === 465,
			auth: {
				user: this.creds.username,
				pass: this.creds.password,
			},
		});
	}

	async searchEmails(
		folder: string,
		criteria: EmailSearchCriteria,
		maxResults: number,
	): Promise<EmailSummary[]> {
		const client = createImapClient(this.creds);

		try {
			await client.connect();
			logger.debug('Connected to IMAP server for search', { folder });

			const lock = await client.getMailboxLock(folder);
			try {
				const query = buildSearchQuery(criteria);
				const searchResult = await client.search(query, { uid: true });

				if (searchResult === false || searchResult.length === 0) {
					return [];
				}

				logger.debug('IMAP search returned UIDs', { count: searchResult.length, folder });

				const limitedUids = searchResult.slice(-maxResults).reverse();

				const results: EmailSummary[] = [];
				for await (const msg of client.fetch(limitedUids, {
					uid: true,
					envelope: true,
					bodyStructure: true,
					source: { start: 0, maxLength: 500 },
				})) {
					const envelope = msg.envelope;
					results.push({
						uid: msg.uid,
						date: envelope?.date ?? new Date(),
						from: parseAddress(envelope?.from?.[0]),
						to: parseAddresses(envelope?.to),
						subject: envelope?.subject ?? '(no subject)',
						snippet: msg.source?.toString('utf8').slice(0, 200) ?? '',
					});
				}

				return results;
			} finally {
				lock.release();
			}
		} finally {
			await client.logout();
		}
	}

	async readEmail(folder: string, uid: number): Promise<EmailMessage> {
		const client = createImapClient(this.creds);

		try {
			await client.connect();
			logger.debug('Connected to IMAP server for read', { folder, uid });

			const lock = await client.getMailboxLock(folder);
			try {
				const message = await client.fetchOne(
					uid,
					{ uid: true, envelope: true, bodyStructure: true, source: true },
					{ uid: true },
				);

				if (!message) {
					throw new Error(`Email with UID ${uid} not found in folder ${folder}`);
				}

				const envelope = message.envelope;
				const source = message.source?.toString('utf8') ?? '';

				const { textBody, htmlBody } = parseEmailBody(source);
				const attachments = extractAttachments(message.bodyStructure);
				const { messageId, inReplyTo, references } = parseThreadingHeaders(source);

				return {
					uid,
					messageId,
					date: envelope?.date ?? new Date(),
					from: parseAddress(envelope?.from?.[0]),
					to: parseAddresses(envelope?.to),
					cc: parseAddresses(envelope?.cc),
					subject: envelope?.subject ?? '(no subject)',
					textBody,
					htmlBody,
					attachments,
					inReplyTo,
					references,
				};
			} finally {
				lock.release();
			}
		} finally {
			await client.logout();
		}
	}

	async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
		const transport = this.buildSmtpTransport();

		try {
			logger.debug('Sending email via SMTP', { to: options.to, subject: options.subject });

			const result = await transport.sendMail({
				from: this.creds.username,
				to: options.to,
				cc: options.cc,
				bcc: options.bcc,
				subject: options.subject,
				text: options.body,
				html: options.html,
			});

			logger.debug('Email sent successfully', {
				messageId: result.messageId,
				accepted: result.accepted,
			});

			return {
				messageId: result.messageId,
				accepted: Array.isArray(result.accepted)
					? result.accepted.filter((a: unknown): a is string => typeof a === 'string')
					: [],
				rejected: Array.isArray(result.rejected)
					? result.rejected.filter((r: unknown): r is string => typeof r === 'string')
					: [],
			};
		} finally {
			await transport.close();
		}
	}

	async replyToEmail(options: ReplyEmailOptions): Promise<SendEmailResult> {
		const original = await this.readEmail(options.folder, options.uid);

		const fromEmail = this.creds.username;
		const selfEmailLower = fromEmail.toLowerCase();

		const recipients: string[] = [];
		if (options.replyAll) {
			recipients.push(original.from);
			recipients.push(
				...original.to.filter((addr) => !addr.toLowerCase().includes(selfEmailLower)),
			);
			recipients.push(
				...original.cc.filter((addr) => !addr.toLowerCase().includes(selfEmailLower)),
			);
		} else {
			recipients.push(original.from);
		}

		const subject = original.subject.startsWith('Re:')
			? original.subject
			: `Re: ${original.subject}`;

		const references = [...original.references];
		if (original.messageId && !references.includes(original.messageId)) {
			references.push(original.messageId);
		}

		const transport = this.buildSmtpTransport();

		try {
			logger.debug('Sending reply via SMTP', {
				to: recipients,
				subject,
				inReplyTo: original.messageId,
			});

			const result = await transport.sendMail({
				from: fromEmail,
				to: recipients,
				subject,
				text: options.body,
				inReplyTo: original.messageId ? `<${original.messageId}>` : undefined,
				references: references.map((r) => `<${r}>`).join(' ') || undefined,
			});

			logger.debug('Reply sent successfully', {
				messageId: result.messageId,
				accepted: result.accepted,
			});

			return {
				messageId: result.messageId,
				accepted: Array.isArray(result.accepted)
					? result.accepted.filter((a: unknown): a is string => typeof a === 'string')
					: [],
				rejected: Array.isArray(result.rejected)
					? result.rejected.filter((r: unknown): r is string => typeof r === 'string')
					: [],
			};
		} finally {
			await transport.close();
		}
	}

	async markEmailAsSeen(folder: string, uid: number): Promise<void> {
		const client = createImapClient(this.creds);

		try {
			await client.connect();
			logger.debug('Connected to IMAP server for mark-as-seen', { folder, uid });

			const lock = await client.getMailboxLock(folder);
			try {
				await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
				logger.debug('Email marked as seen', { folder, uid });
			} catch (error) {
				logger.error('Failed to mark email as seen', {
					folder,
					uid,
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			} finally {
				lock.release();
			}
		} finally {
			await client.logout();
		}
	}
}
