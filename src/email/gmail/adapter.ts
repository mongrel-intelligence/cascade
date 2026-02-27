/**
 * GmailEmailProvider — EmailProvider backed by IMAP (read) + Gmail REST API (send).
 *
 * Uses the same IMAP helpers as ImapEmailProvider for reading, but routes all
 * outbound mail through the Gmail REST API to avoid SMTP port 465 being blocked
 * in container environments.
 */

import { logger } from '../../utils/logging.js';
import {
	buildSearchQuery,
	createImapClient,
	extractAttachments,
	parseAddress,
	parseAddresses,
	parseEmailBody,
	parseThreadingHeaders,
} from '../imap/utils.js';
import type { EmailProvider } from '../provider.js';
import type {
	EmailMessage,
	EmailSearchCriteria,
	EmailSummary,
	OAuthEmailCredentials,
	ReplyEmailOptions,
	SendEmailOptions,
	SendEmailResult,
} from '../types.js';
import { replyViaGmailApi, sendViaGmailApi } from './send.js';

export class GmailEmailProvider implements EmailProvider {
	readonly type = 'gmail';

	constructor(private readonly creds: OAuthEmailCredentials) {}

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
		logger.debug('Sending email via Gmail API', { to: options.to, subject: options.subject });
		return sendViaGmailApi(options, this.creds.accessToken, this.creds.email);
	}

	async replyToEmail(options: ReplyEmailOptions): Promise<SendEmailResult> {
		const original = await this.readEmail(options.folder, options.uid);
		logger.debug('Sending reply via Gmail API', { uid: options.uid, replyAll: options.replyAll });
		return replyViaGmailApi(options, original, this.creds.accessToken, this.creds.email);
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
