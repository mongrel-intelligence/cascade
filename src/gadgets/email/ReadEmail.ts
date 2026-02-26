import { Gadget, z } from 'llmist';
import { readEmail } from './core/readEmail.js';

export class ReadEmail extends Gadget({
	name: 'ReadEmail',
	description:
		'Read the full content of an email by its UID. Use the UID from SearchEmails results.',
	timeoutMs: 30000,
	schema: z.object({
		folder: z.string().min(1).max(100).default('INBOX').describe('Mailbox folder (default: INBOX)'),
		uid: z.number().int().positive().describe('Email UID (from SearchEmails results)'),
	}),
	examples: [
		{
			params: { folder: 'INBOX', uid: 123 },
			comment: 'Read email with UID 123 from the inbox',
		},
		{
			params: { folder: 'Sent', uid: 456 },
			comment: 'Read a sent email with UID 456',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return readEmail(params.folder, params.uid);
	}
}
