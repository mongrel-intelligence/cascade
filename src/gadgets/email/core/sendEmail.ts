import { getEmailProvider } from '../../../email/context.js';
import type { SendEmailOptions } from '../../../email/types.js';
import { logger } from '../../../utils/logging.js';

export async function sendEmail(options: SendEmailOptions): Promise<string> {
	try {
		const result = await getEmailProvider().sendEmail(options);

		const accepted = result.accepted.join(', ');
		const rejected = result.rejected.length > 0 ? ` (rejected: ${result.rejected.join(', ')})` : '';

		if (!accepted) {
			return `Email delivery failed — all recipients rejected${rejected} (Message-ID: ${result.messageId})`;
		}
		return `Email sent successfully to ${accepted}${rejected} (Message-ID: ${result.messageId})`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Email send failed', {
			to: options.to,
			subject: options.subject,
			error: message,
		});
		return `Error sending email: ${message}`;
	}
}
