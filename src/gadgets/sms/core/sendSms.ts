import { getSmsProvider } from '../../../sms/context.js';
import type { SendSmsOptions } from '../../../sms/types.js';
import { logger } from '../../../utils/logging.js';

export async function sendSms(options: SendSmsOptions): Promise<string> {
	try {
		const result = await getSmsProvider().sendSms(options);
		return `SMS sent successfully to ${options.to} (SID: ${result.sid}, status: ${result.status})`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('SMS send failed', {
			to: options.to,
			error: message,
		});
		return `Error sending SMS: ${message}`;
	}
}
