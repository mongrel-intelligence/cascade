import { getEmailProvider } from '../../../email/context.js';
import { logger } from '../../../utils/logging.js';

export async function readEmail(folder: string, uid: number): Promise<string> {
	try {
		const email = await getEmailProvider().readEmail(folder, uid);

		const lines: string[] = [`From: ${email.from}`, `To: ${email.to.join(', ')}`];

		if (email.cc.length > 0) {
			lines.push(`CC: ${email.cc.join(', ')}`);
		}

		lines.push(`Date: ${email.date.toISOString()}`, `Subject: ${email.subject}`);

		if (email.messageId) {
			lines.push(`Message-ID: ${email.messageId}`);
		}

		if (email.attachments.length > 0) {
			lines.push(
				`Attachments: ${email.attachments.map((a) => `${a.filename} (${a.contentType}, ${a.size} bytes)`).join(', ')}`,
			);
		}

		// Show text body, or HTML body if text is not available
		if (email.textBody) {
			lines.push('', '--- Body (Text) ---', '', email.textBody);
		} else if (email.htmlBody) {
			lines.push('', '--- Body (HTML) ---', '', email.htmlBody);
		} else {
			lines.push('', '(no body)');
		}

		return lines.join('\n');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Email read failed', {
			folder,
			uid,
			error: message,
		});
		return `Error reading email: ${message}`;
	}
}
