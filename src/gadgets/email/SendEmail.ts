import { Gadget, z } from 'llmist';
import { sendEmail } from './core/sendEmail.js';

export class SendEmail extends Gadget({
	name: 'SendEmail',
	description: 'Send an email via SMTP. Use this to communicate with external parties via email.',
	timeoutMs: 30000,
	schema: z.object({
		to: z.array(z.string().email()).min(1).describe('Recipient email addresses'),
		subject: z.string().min(1).max(998).describe('Email subject line (max 998 chars per RFC 2822)'),
		body: z.string().min(1).max(10_000_000).describe('Email body (plain text)'),
		html: z
			.string()
			.max(10_000_000)
			.optional()
			.describe('HTML body (optional, overrides plain text for HTML clients)'),
		cc: z.array(z.string().email()).optional().describe('CC recipients'),
		bcc: z.array(z.string().email()).optional().describe('BCC recipients'),
	}),
	examples: [
		{
			params: {
				to: ['user@example.com'],
				subject: 'Status Update',
				body: 'The task has been completed successfully.',
			},
			comment: 'Send a simple status update email',
		},
		{
			params: {
				to: ['team@example.com'],
				subject: 'Weekly Report',
				body: 'Please find the weekly report attached.',
				cc: ['manager@example.com'],
			},
			comment: 'Send an email with CC recipients',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return sendEmail({
			to: params.to,
			subject: params.subject,
			body: params.body,
			html: params.html,
			cc: params.cc,
			bcc: params.bcc,
		});
	}
}
