import { markEmailAsSeen as markEmailAsSeenClient } from '../../../email/client.js';
import { logger } from '../../../utils/logging.js';

export async function markEmailAsSeen(folder: string, uid: number): Promise<string> {
	try {
		await markEmailAsSeenClient(folder, uid);
		return `Email (UID: ${uid}) in folder "${folder}" has been marked as seen/read.`;
	} catch (error) {
		logger.error('Mark email as seen failed', {
			folder,
			uid,
			error: error instanceof Error ? error.message : String(error),
		});
		const message = error instanceof Error ? error.message : String(error);
		return `Error marking email as seen: ${message}`;
	}
}
