/**
 * TwilioSmsProvider — sends SMS messages via the Twilio REST API.
 */

import twilio from 'twilio';
import type { SmsProvider } from '../provider.js';
import type { SendSmsOptions, SendSmsResult, SmsCredentials } from '../types.js';

export class TwilioSmsProvider implements SmsProvider {
	readonly type = 'twilio';
	private client: ReturnType<typeof twilio>;
	private fromNumber: string;

	constructor(creds: SmsCredentials) {
		this.client = twilio(creds.accountSid, creds.authToken);
		this.fromNumber = creds.phoneNumber;
	}

	async sendSms(options: SendSmsOptions): Promise<SendSmsResult> {
		const msg = await this.client.messages.create({
			to: options.to,
			from: this.fromNumber,
			body: options.body,
		});
		return { sid: msg.sid, status: msg.status };
	}
}
