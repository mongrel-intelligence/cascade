import { Gadget, z } from 'llmist';
import { sendSms } from './core/sendSms.js';

export class SendSms extends Gadget({
	name: 'SendSms',
	description:
		'Send an SMS message via Twilio. Use this to communicate with users via text message.',
	timeoutMs: 30000,
	schema: z.object({
		to: z.string().describe('Recipient phone number in E.164 format (e.g. +15551234567)'),
		body: z.string().min(1).max(1600).describe('SMS message body (max 1600 characters)'),
	}),
	examples: [
		{
			params: {
				to: '+15551234567',
				body: 'Your request has been processed.',
			},
			comment: 'Send a simple status SMS',
		},
	],
}) {
	override async execute(params: this['params']): Promise<string> {
		return sendSms({
			to: params.to,
			body: params.body,
		});
	}
}
