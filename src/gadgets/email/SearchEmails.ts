import { Gadget, z } from 'llmist';
import { searchEmails } from './core/searchEmails.js';

export class SearchEmails extends Gadget({
	name: 'SearchEmails',
	description:
		'Search emails in a mailbox folder using IMAP criteria. Returns a list of matching emails with UID, date, subject, and sender.',
	timeoutMs: 60000,
	schema: z.object({
		folder: z
			.string()
			.min(1)
			.max(100)
			.default('INBOX')
			.describe('Mailbox folder to search (default: INBOX)'),
		criteria: z
			.object({
				from: z.string().optional().describe('Sender email or name'),
				to: z.string().optional().describe('Recipient email or name'),
				subject: z.string().optional().describe('Subject line contains this text'),
				body: z.string().optional().describe('Body contains this text'),
				since: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/)
					.optional()
					.describe('Messages since date (YYYY-MM-DD)'),
				before: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/)
					.optional()
					.describe('Messages before date (YYYY-MM-DD)'),
				unseen: z.boolean().optional().describe('Only unread messages'),
			})
			.strict()
			.describe('IMAP search criteria'),
		maxResults: z
			.number()
			.min(1)
			.max(50)
			.default(10)
			.describe('Maximum number of results to return (1-50, default: 10)'),
	}),
	examples: [
		{
			params: {
				folder: 'INBOX',
				criteria: { from: 'client@example.com', unseen: true },
				maxResults: 5,
			},
			comment: 'Search for unread emails from a specific sender',
		},
		{
			params: {
				folder: 'INBOX',
				criteria: { subject: 'urgent', since: '2024-01-01' },
				maxResults: 10,
			},
			comment: 'Search for emails with "urgent" in the subject since January 2024',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return searchEmails(params.folder, params.criteria, params.maxResults);
	}
}
