/**
 * Email module barrel.
 *
 * Registers all provider adapters at import time (mirrors pm/index.ts).
 * Consumers import from here to get both the public API and side-effect registration.
 */

import { GmailIntegration } from './gmail/integration.js';
import { ImapIntegration } from './imap/integration.js';
import { emailRegistry } from './registry.js';

emailRegistry.register(new ImapIntegration());
emailRegistry.register(new GmailIntegration());

// Provider scoping
export { getEmailProvider, getEmailProviderOrNull, withEmailProvider } from './context.js';

// Integration credential resolution
export { hasEmailIntegration, withEmailIntegration } from './integration.js';

// Registry (for advanced use cases)
export { emailRegistry } from './registry.js';

// Interfaces
export type { EmailIntegration, EmailProvider } from './provider.js';

// Types
export type {
	EmailAttachment,
	EmailCredentials,
	EmailMessage,
	EmailSearchCriteria,
	EmailSummary,
	ReplyEmailOptions,
	SendEmailOptions,
	SendEmailResult,
} from './types.js';
