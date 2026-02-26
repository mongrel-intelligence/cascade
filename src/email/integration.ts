/**
 * Email integration — credential resolution and scoping.
 *
 * Provides withEmailIntegration() for establishing email credential scope
 * similar to withPMCredentials() for PM integrations.
 */

import { getIntegrationCredential } from '../config/provider.js';
import { logger } from '../utils/logging.js';
import { withEmailCredentials } from './client.js';
import type { EmailCredentials } from './types.js';

/**
 * Resolve email credentials for a project from the database.
 */
export async function resolveEmailCredentials(projectId: string): Promise<EmailCredentials | null> {
	try {
		const [imapHost, imapPortStr, smtpHost, smtpPortStr, username, password] = await Promise.all([
			getIntegrationCredential(projectId, 'email', 'imap_host'),
			getIntegrationCredential(projectId, 'email', 'imap_port'),
			getIntegrationCredential(projectId, 'email', 'smtp_host'),
			getIntegrationCredential(projectId, 'email', 'smtp_port'),
			getIntegrationCredential(projectId, 'email', 'username'),
			getIntegrationCredential(projectId, 'email', 'password'),
		]);

		// All credentials are required
		if (!imapHost || !imapPortStr || !smtpHost || !smtpPortStr || !username || !password) {
			return null;
		}

		const imapPort = Number.parseInt(imapPortStr, 10);
		const smtpPort = Number.parseInt(smtpPortStr, 10);

		if (Number.isNaN(imapPort) || Number.isNaN(smtpPort)) {
			return null;
		}

		return {
			imapHost,
			imapPort,
			smtpHost,
			smtpPort,
			username,
			password,
		};
	} catch (error) {
		logger.warn('Failed to resolve email credentials', {
			projectId,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/**
 * Run a function with email credentials in scope for a project.
 *
 * If no email integration is configured for the project, runs fn() without
 * email credentials (gadgets will fail with clear error messages).
 */
export async function withEmailIntegration<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
	const creds = await resolveEmailCredentials(projectId);
	if (!creds) {
		// No email integration configured — run without credentials
		return fn();
	}
	return withEmailCredentials(creds, fn);
}

/**
 * Check if email integration is configured for a project.
 */
export async function hasEmailIntegration(projectId: string): Promise<boolean> {
	const creds = await resolveEmailCredentials(projectId);
	return creds !== null;
}
