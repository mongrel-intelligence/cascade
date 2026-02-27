// Email client and credential scoping
export {
	withEmailCredentials,
	getEmailCredentials,
	searchEmails,
	readEmail,
	sendEmail,
	replyToEmail,
} from './client.js';

// Integration credential resolution
export {
	resolveEmailCredentials,
	withEmailIntegration,
	hasEmailIntegration,
} from './integration.js';

// Types
export type {
	EmailCredentials,
	EmailSearchCriteria,
	EmailSummary,
	EmailMessage,
	EmailAttachment,
	SendEmailOptions,
	SendEmailResult,
	ReplyEmailOptions,
} from './types.js';
