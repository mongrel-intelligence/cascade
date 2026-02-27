import { Gadget, z } from 'llmist';
import { replyToEmail } from './core/replyToEmail.js';

export class ReplyToEmail extends Gadget({
	name: 'ReplyToEmail',
	description:
		'Reply to an existing email thread. The reply will be properly threaded with the original message.',
	timeoutMs: 30000,
	schema: z.object({
		folder: z
			.string()
			.min(1)
			.max(100)
			.default('INBOX')
			.describe('Mailbox folder containing the original email (default: INBOX)'),
		uid: z.number().int().positive().describe('Email UID to reply to (from SearchEmails results)'),
		body: z.string().min(1).max(10_000_000).describe('Reply body text'),
		replyAll: z
			.boolean()
			.default(false)
			.describe('Reply to all recipients (default: false, reply only to sender)'),
	}),
	examples: [
		{
			params: {
				folder: 'INBOX',
				uid: 123,
				body: 'Thank you for the update. We will proceed with the plan.',
				replyAll: false,
			},
			comment: 'Reply to the sender only',
		},
		{
			params: {
				folder: 'INBOX',
				uid: 456,
				body: 'I have reviewed the proposal and have some feedback...',
				replyAll: true,
			},
			comment: 'Reply to all recipients in the thread',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return replyToEmail(params.folder, params.uid, params.body, params.replyAll);
	}
}
