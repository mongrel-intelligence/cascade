import { getEmailProvider } from '../../../email/context.js';
import type { EmailSearchCriteria } from '../../../email/types.js';
import { logger } from '../../../utils/logging.js';

export async function searchEmails(
	folder: string,
	criteria: EmailSearchCriteria,
	maxResults: number,
): Promise<string> {
	try {
		const results = await getEmailProvider().searchEmails(folder, criteria, maxResults);

		if (results.length === 0) {
			return 'No emails found matching the search criteria.';
		}

		const lines: string[] = [`Found ${results.length} email(s):`, ''];

		results.forEach((email, index) => {
			const dateStr = email.date.toISOString().split('T')[0];
			lines.push(
				`${index + 1}. [UID:${email.uid}] ${dateStr} - "${email.subject}" from ${email.from}`,
			);
		});

		return lines.join('\n');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Email search failed', {
			folder,
			criteria,
			error: message,
		});
		return `Error searching emails: ${message}`;
	}
}
