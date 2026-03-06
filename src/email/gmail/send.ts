/**
 * Gmail REST API send helpers.
 *
 * Used instead of SMTP for OAuth accounts to avoid SMTP port 465 being blocked
 * in container environments. The access token is managed by the caller (already
 * refreshed/cached in oauth.ts before this point).
 */

import { gmail } from '@googleapis/gmail';
import { OAuth2Client } from 'google-auth-library';
import nodemailer from 'nodemailer';
import type {
	EmailMessage,
	ReplyEmailOptions,
	SendEmailOptions,
	SendEmailResult,
} from '../types.js';

/**
 * Build a base64url-encoded RFC 822 message using nodemailer's in-process
 * streamTransport (no network connection — pure MIME encoding).
 */
async function buildRawMessage(mailOptions: Record<string, unknown>): Promise<string> {
	const transport = nodemailer.createTransport({ streamTransport: true, newline: 'unix' });
	const info = await transport.sendMail(mailOptions as Parameters<typeof transport.sendMail>[0]);
	const chunks: Buffer[] = [];
	for await (const chunk of info.message as AsyncIterable<Buffer | string>) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
	}
	return Buffer.concat(chunks).toString('base64url');
}

/**
 * Create a Gmail API client authenticated with the given access token.
 */
function createGmailClient(accessToken: string) {
	const auth = new OAuth2Client();
	auth.setCredentials({ access_token: accessToken });
	return gmail({ version: 'v1', auth });
}

/**
 * Send an email via the Gmail REST API.
 *
 * @param options - Email send options (to, subject, body, etc.)
 * @param accessToken - Valid Gmail OAuth2 access token
 * @param fromEmail - Sender's email address
 */
export async function sendViaGmailApi(
	options: SendEmailOptions,
	accessToken: string,
	fromEmail: string,
): Promise<SendEmailResult> {
	const raw = await buildRawMessage({
		from: fromEmail,
		to: options.to,
		cc: options.cc,
		bcc: options.bcc,
		subject: options.subject,
		text: options.body,
		html: options.html,
	});

	const client = createGmailClient(accessToken);
	const res = await client.users.messages.send({ userId: 'me', requestBody: { raw } });

	return {
		messageId: `<${res.data.id}@mail.gmail.com>`,
		accepted: options.to,
		rejected: [],
	};
}

/**
 * Send an email reply via the Gmail REST API.
 *
 * Takes the already-fetched original message (via IMAP) to build correct
 * threading headers (In-Reply-To, References). Only the sending step uses
 * the REST API — IMAP reading is unchanged.
 *
 * @param options - Reply options (body, replyAll flag)
 * @param original - Original email message fetched via IMAP
 * @param accessToken - Valid Gmail OAuth2 access token
 * @param fromEmail - Sender's email address
 */
export async function replyViaGmailApi(
	options: ReplyEmailOptions,
	original: EmailMessage,
	accessToken: string,
	fromEmail: string,
): Promise<SendEmailResult> {
	const selfLower = fromEmail.toLowerCase();

	const recipients = options.replyAll
		? [
				original.from,
				...original.to.filter((a) => !a.toLowerCase().includes(selfLower)),
				...original.cc.filter((a) => !a.toLowerCase().includes(selfLower)),
			]
		: [original.from];

	const subject = original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`;

	const references = [...original.references];
	if (original.messageId && !references.includes(original.messageId)) {
		references.push(original.messageId);
	}

	const raw = await buildRawMessage({
		from: fromEmail,
		to: recipients,
		subject,
		text: options.body,
		inReplyTo: original.messageId ? `<${original.messageId}>` : undefined,
		references: references.length > 0 ? references.map((r) => `<${r}>`).join(' ') : undefined,
	});

	const client = createGmailClient(accessToken);
	const res = await client.users.messages.send({ userId: 'me', requestBody: { raw } });

	return {
		messageId: `<${res.data.id}@mail.gmail.com>`,
		accepted: recipients,
		rejected: [],
	};
}
