/**
 * Shared IMAP/MIME helpers used by both ImapEmailProvider and GmailEmailProvider.
 */

import { ImapFlow } from 'imapflow';
import type { EmailAttachment, EmailSearchCriteria } from '../types.js';
import type { EmailCredentials } from '../types.js';

/**
 * Create an ImapFlow client configured with the given credentials.
 * Supports both password and OAuth (XOAUTH2) authentication.
 */
export function createImapClient(creds: EmailCredentials): ImapFlow {
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
		secure: true,
		auth,
		logger: false,
		connectionTimeout: 30000,
		greetingTimeout: 15000,
		socketTimeout: 60000,
	});
}

/**
 * Parse an email address object/string into a simple string.
 */
export function parseAddress(addr: unknown): string {
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
export function parseAddresses(addrs: unknown): string[] {
	if (!addrs) return [];
	if (Array.isArray(addrs)) return addrs.map(parseAddress).filter(Boolean);
	return [parseAddress(addrs)].filter(Boolean);
}

/**
 * Build an IMAP search query from EmailSearchCriteria.
 */
export function buildSearchQuery(criteria: EmailSearchCriteria): Record<string, unknown> {
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
 */
export function parseEmailBody(source: string): { textBody: string; htmlBody?: string } {
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
 * Parse threading headers from raw email source.
 */
export function parseThreadingHeaders(source: string): {
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
export function extractAttachments(bodyStruct: unknown): EmailAttachment[] {
	const attachments: EmailAttachment[] = [];

	if (!bodyStruct || typeof bodyStruct !== 'object') {
		return attachments;
	}

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
