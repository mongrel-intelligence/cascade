/**
 * Email client with AsyncLocalStorage-based credential scoping.
 *
 * Uses imapflow for IMAP operations and nodemailer for SMTP.
 * Credentials are scoped per-request via withEmailCredentials().
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { logger } from '../utils/logging.js';
import type {
	EmailCredentials,
	EmailMessage,
	EmailSearchCriteria,
	EmailSummary,
	ReplyEmailOptions,
	SendEmailOptions,
	SendEmailResult,
} from './types.js';

const emailCredentialStore = new AsyncLocalStorage<EmailCredentials>();

/**
 * Run a function with email credentials in scope.
 */
export function withEmailCredentials<T>(creds: EmailCredentials, fn: () => Promise<T>): Promise<T> {
	return emailCredentialStore.run(creds, fn);
}

/**
 * Get the current email credentials from AsyncLocalStorage.
 * Throws if no credentials are in scope.
 */
export function getEmailCredentials(): EmailCredentials {
	const scoped = emailCredentialStore.getStore();
	if (!scoped) {
		throw new Error(
			'No email credentials in scope. Wrap the call with withEmailCredentials() or ensure per-project email credentials are set in the database.',
		);
	}
	return scoped;
}

/**
 * Get the email address from credentials, regardless of auth method.
 */
export function getEmailAddress(): string {
	const creds = getEmailCredentials();
	return creds.authMethod === 'oauth' ? creds.email : creds.username;
}

/**
 * Create an ImapFlow client configured with scoped credentials.
 * Supports both password and OAuth (XOAUTH2) authentication.
 */
function createImapClient(): ImapFlow {
	const creds = getEmailCredentials();

	// Build auth config based on authentication method
	const auth =
		creds.authMethod === 'oauth'
			? {
					user: creds.email,
					accessToken: creds.accessToken,
				}
			: {
					user: creds.username,
					pass: creds.password,
				};

	return new ImapFlow({
		host: creds.imapHost,
		port: creds.imapPort,
		secure: true, // Use TLS
		auth,
		logger: false, // Suppress imapflow's built-in logging
		connectionTimeout: 30000, // 30s to establish connection
		greetingTimeout: 15000, // 15s to receive server greeting
		socketTimeout: 60000, // 60s for socket operations
	});
}

/**
 * Create a nodemailer transporter configured with scoped credentials.
 * Supports both password and OAuth (XOAUTH2) authentication.
 */
function createSmtpTransport(): Transporter {
	const creds = getEmailCredentials();

	// Build auth config based on authentication method
	const auth =
		creds.authMethod === 'oauth'
			? {
					type: 'OAuth2' as const,
					user: creds.email,
					accessToken: creds.accessToken,
				}
			: {
					user: creds.username,
					pass: creds.password,
				};

	return nodemailer.createTransport({
		host: creds.smtpHost,
		port: creds.smtpPort,
		secure: creds.smtpPort === 465, // Use TLS for port 465, STARTTLS for 587
		auth,
	});
}

/**
 * Parse an email address object/string into a simple string.
 */
function parseAddress(addr: unknown): string {
	if (!addr) return '';
	if (typeof addr === 'string') return addr;
	if (typeof addr === 'object' && addr !== null) {
		const obj = addr as { address?: string; name?: string };
		if (obj.address) {
			return obj.name ? `${obj.name} <${obj.address}>` : obj.address;
		}
	}
	return String(addr);
}

/**
 * Parse an array of addresses.
 */
function parseAddresses(addrs: unknown): string[] {
	if (!addrs) return [];
	if (Array.isArray(addrs)) return addrs.map(parseAddress).filter(Boolean);
	return [parseAddress(addrs)].filter(Boolean);
}

/**
 * Build an IMAP search query from EmailSearchCriteria.
 */
function buildSearchQuery(criteria: EmailSearchCriteria): Record<string, unknown> {
	const searchQuery: Record<string, unknown> = {};

	if (criteria.from) searchQuery.from = criteria.from;
	if (criteria.to) searchQuery.to = criteria.to;
	if (criteria.subject) searchQuery.subject = criteria.subject;
	if (criteria.body) searchQuery.body = criteria.body;
	if (criteria.since) searchQuery.since = new Date(criteria.since);
	if (criteria.before) searchQuery.before = new Date(criteria.before);
	if (criteria.unseen) searchQuery.seen = false;

	return Object.keys(searchQuery).length > 0 ? searchQuery : { all: true };
}

/**
 * Parse email body content from raw source.
 * Simple regex-based parsing (for proper MIME parsing, use mailparser).
 */
function parseEmailBody(source: string): { textBody: string; htmlBody?: string } {
	let textBody = '';
	let htmlBody: string | undefined;

	const textMatch = source.match(
		/Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)(?=--|\r\n\r\n--|\Z)/i,
	);
	if (textMatch) {
		textBody = textMatch[1].trim();
	} else {
		const headerEnd = source.indexOf('\r\n\r\n');
		if (headerEnd > 0) {
			textBody = source.slice(headerEnd + 4).trim();
		}
	}

	const htmlMatch = source.match(
		/Content-Type: text\/html[\s\S]*?\r\n\r\n([\s\S]*?)(?=--|\r\n\r\n--|\Z)/i,
	);
	if (htmlMatch) {
		htmlBody = htmlMatch[1].trim();
	}

	return { textBody, htmlBody };
}

/**
 * Check if a node represents an attachment and extract its info.
 */
function tryExtractAttachment(
	node: Record<string, unknown>,
): { filename: string; contentType: string; size: number } | null {
	if (node.disposition !== 'attachment' || !node.dispositionParameters) {
		return null;
	}
	const params = node.dispositionParameters as { filename?: string };
	return {
		filename: params.filename ?? 'attachment',
		contentType: `${node.type ?? 'application'}/${node.subtype ?? 'octet-stream'}`,
		size: (node.size as number) ?? 0,
	};
}

/**
 * Extract attachment info from IMAP body structure using iterative traversal.
 */
function extractAttachments(
	bodyStruct: unknown,
): Array<{ filename: string; contentType: string; size: number }> {
	const attachments: Array<{ filename: string; contentType: string; size: number }> = [];

	if (!bodyStruct || typeof bodyStruct !== 'object') {
		return attachments;
	}

	// Use a stack for iterative traversal to avoid recursion complexity
	const stack: unknown[] = [bodyStruct];

	while (stack.length > 0) {
		const current = stack.pop();
		if (typeof current !== 'object' || current === null) continue;

		const node = current as Record<string, unknown>;
		const attachment = tryExtractAttachment(node);
		if (attachment) {
			attachments.push(attachment);
		}

		if (Array.isArray(node.childNodes)) {
			stack.push(...node.childNodes);
		}
	}

	return attachments;
}

/**
 * Parse threading headers from raw email source.
 */
function parseThreadingHeaders(source: string): {
	messageId: string;
	inReplyTo?: string;
	references: string[];
} {
	const messageIdMatch = source.match(/Message-ID:\s*<([^>]+)>/i);
	const inReplyToMatch = source.match(/In-Reply-To:\s*<([^>]+)>/i);
	const referencesMatch = source.match(/References:\s*(.+?)(?=\r\n[^\s]|\r\n\r\n)/is);

	const references: string[] = [];
	if (referencesMatch) {
		const refMatches = referencesMatch[1].match(/<[^>]+>/g);
		if (refMatches) {
			references.push(...refMatches.map((r) => r.slice(1, -1)));
		}
	}

	return {
		messageId: messageIdMatch?.[1] ?? '',
		inReplyTo: inReplyToMatch?.[1],
		references,
	};
}

// ============================================================================
// IMAP Operations
// ============================================================================

/**
 * Search emails in a mailbox folder using IMAP criteria.
 */
export async function searchEmails(
	folder: string,
	criteria: EmailSearchCriteria,
	maxResults: number,
): Promise<EmailSummary[]> {
	const client = createImapClient();

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

			// Limit results and sort by UID descending (newest first)
			const limitedUids = searchResult.slice(-maxResults).reverse();

			// Fetch message summaries
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

/**
 * Read a full email message by UID.
 */
export async function readEmail(folder: string, uid: number): Promise<EmailMessage> {
	const client = createImapClient();

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

// ============================================================================
// SMTP Operations
// ============================================================================

/**
 * Send an email via SMTP.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
	const fromEmail = getEmailAddress();
	const transport = createSmtpTransport();

	try {
		logger.debug('Sending email via SMTP', {
			to: options.to,
			subject: options.subject,
		});

		const result = await transport.sendMail({
			from: fromEmail,
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

/**
 * Mark an email as seen (read) in the mailbox.
 */
export async function markEmailAsSeen(folder: string, uid: number): Promise<void> {
	const client = createImapClient();

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

export async function replyToEmail(options: ReplyEmailOptions): Promise<SendEmailResult> {
	// First, fetch the original message to get threading info
	const original = await readEmail(options.folder, options.uid);

	// Get our email address for filtering and from field
	const fromEmail = getEmailAddress();
	const selfEmailLower = fromEmail.toLowerCase();

	// Build recipient list
	const recipients: string[] = [];
	if (options.replyAll) {
		// Reply to sender + all original recipients (excluding ourselves)
		recipients.push(original.from);
		recipients.push(...original.to.filter((addr) => !addr.toLowerCase().includes(selfEmailLower)));
		recipients.push(...original.cc.filter((addr) => !addr.toLowerCase().includes(selfEmailLower)));
	} else {
		// Reply only to sender
		recipients.push(original.from);
	}

	// Build subject with Re: prefix if not already present
	const subject = original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`;

	// Build references header for threading
	const references = [...original.references];
	if (original.messageId && !references.includes(original.messageId)) {
		references.push(original.messageId);
	}

	// Send the reply
	const transport = createSmtpTransport();

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
