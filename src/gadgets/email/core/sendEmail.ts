import { sendEmail as sendEmailClient } from '../../../email/client.js';
import type { SendEmailOptions } from '../../../email/types.js';
import { logger } from '../../../utils/logging.js';

export async function sendEmail(options: SendEmailOptions): Promise<string> {
	try {
		const result = await sendEmailClient(options);

		const accepted = result.accepted.join(', ');
		const rejected = result.rejected.length > 0 ? ` (rejected: ${result.rejected.join(', ')})` : '';

		return `Email sent successfully to ${accepted}${rejected} (Message-ID: ${result.messageId})`;
	} catch (error) {
		logger.error('Email send failed', {
			to: options.to,
			subject: options.subject,
			error: error instanceof Error ? error.message : String(error),
		});
		const message = error instanceof Error ? error.message : String(error);
		return `Error sending email: ${message}`;
	}
}
