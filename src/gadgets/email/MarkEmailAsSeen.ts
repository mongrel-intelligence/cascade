import { Gadget, z } from 'llmist';
import { markEmailAsSeen } from './core/markEmailAsSeen.js';

export class MarkEmailAsSeen extends Gadget({
	name: 'MarkEmailAsSeen',
	description:
		'Mark an email as seen/read in the mailbox. Use this after processing an email to prevent re-processing on subsequent runs.',
	timeoutMs: 15000,
	schema: z.object({
		folder: z
			.string()
			.min(1)
			.max(100)
			.default('INBOX')
			.describe('Mailbox folder where the email is located (default: INBOX)'),
		uid: z
			.number()
			.int()
			.positive()
			.describe('Unique identifier (UID) of the email to mark as seen'),
	}),
	examples: [
		{
			params: { folder: 'INBOX', uid: 456 },
			comment: 'Mark email with UID 456 in INBOX as read',
		},
		{
			params: { folder: 'INBOX', uid: 123 },
			comment: 'Mark email with UID 123 in INBOX as read',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return markEmailAsSeen(params.folder, params.uid);
	}
}
