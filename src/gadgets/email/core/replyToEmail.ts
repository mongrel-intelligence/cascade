import { replyToEmail as replyToEmailClient } from '../../../email/client.js';
import { logger } from '../../../utils/logging.js';

export async function replyToEmail(
	folder: string,
	uid: number,
	body: string,
	replyAll: boolean,
): Promise<string> {
	try {
		const result = await replyToEmailClient({ folder, uid, body, replyAll });

		const accepted = result.accepted.join(', ');
		const rejected = result.rejected.length > 0 ? ` (rejected: ${result.rejected.join(', ')})` : '';

		return `Reply sent to ${accepted}${rejected} (Message-ID: ${result.messageId})`;
	} catch (error) {
		logger.error('Email reply failed', {
			folder,
			uid,
			replyAll,
			error: error instanceof Error ? error.message : String(error),
		});
		const message = error instanceof Error ? error.message : String(error);
		return `Error sending reply: ${message}`;
	}
}
