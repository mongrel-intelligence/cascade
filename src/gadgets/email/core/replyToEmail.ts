import { getEmailProvider } from '../../../email/context.js';
import { logger } from '../../../utils/logging.js';

export async function replyToEmail(
	folder: string,
	uid: number,
	body: string,
	replyAll: boolean,
): Promise<string> {
	try {
		const result = await getEmailProvider().replyToEmail({ folder, uid, body, replyAll });

		const accepted = result.accepted.join(', ');
		const rejected = result.rejected.length > 0 ? ` (rejected: ${result.rejected.join(', ')})` : '';

		if (!accepted) {
			return `Email delivery failed — all recipients rejected${rejected} (Message-ID: ${result.messageId})`;
		}
		return `Reply sent to ${accepted}${rejected} (Message-ID: ${result.messageId})`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Email reply failed', {
			folder,
			uid,
			replyAll,
			error: message,
		});
		return `Error sending reply: ${message}`;
	}
}
