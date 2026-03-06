import { getEmailProvider } from '../../../email/context.js';
import { logger } from '../../../utils/logging.js';

export async function markEmailAsSeen(folder: string, uid: number): Promise<string> {
	try {
		await getEmailProvider().markEmailAsSeen(folder, uid);
		return `Email (UID: ${uid}) in folder "${folder}" has been marked as seen/read.`;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Mark email as seen failed', {
			folder,
			uid,
			error: message,
		});
		return `Error marking email as seen: ${message}`;
	}
}
