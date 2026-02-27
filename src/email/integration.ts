/**
 * Email integration — credential resolution and scoping.
 *
 * Provides withEmailIntegration() for establishing email credential scope
 * similar to withPMCredentials() for PM integrations.
 *
 * Supports both IMAP (password) and Gmail (OAuth) authentication.
 */

import { getIntegrationCredentialOrNull, getOrgCredential } from '../config/provider.js';
import { getIntegrationProvider } from '../db/repositories/credentialsRepository.js';
import { logger } from '../utils/logging.js';
import { withEmailCredentials } from './client.js';
import { getGmailAccessToken } from './gmail/oauth.js';
import type { EmailCredentials, OAuthEmailCredentials, PasswordEmailCredentials } from './types.js';

// Gmail IMAP/SMTP server constants
const GMAIL_IMAP_HOST = 'imap.gmail.com';
const GMAIL_IMAP_PORT = 993;
const GMAIL_SMTP_HOST = 'smtp.gmail.com';
const GMAIL_SMTP_PORT = 465;

/**
 * Resolve IMAP password-based email credentials for a project.
 */
async function resolveImapCredentials(projectId: string): Promise<PasswordEmailCredentials | null> {
	const [imapHost, imapPortStr, smtpHost, smtpPortStr, username, password] = await Promise.all([
		getIntegrationCredentialOrNull(projectId, 'email', 'imap_host'),
		getIntegrationCredentialOrNull(projectId, 'email', 'imap_port'),
		getIntegrationCredentialOrNull(projectId, 'email', 'smtp_host'),
		getIntegrationCredentialOrNull(projectId, 'email', 'smtp_port'),
		getIntegrationCredentialOrNull(projectId, 'email', 'username'),
		getIntegrationCredentialOrNull(projectId, 'email', 'password'),
	]);

	// All credentials are required for IMAP
	if (!imapHost || !imapPortStr || !smtpHost || !smtpPortStr || !username || !password) {
		return null;
	}

	const imapPort = Number.parseInt(imapPortStr, 10);
	const smtpPort = Number.parseInt(smtpPortStr, 10);

	if (Number.isNaN(imapPort) || Number.isNaN(smtpPort)) {
		return null;
	}

	return {
		authMethod: 'password',
		imapHost,
		imapPort,
		smtpHost,
		smtpPort,
		username,
		password,
	};
}

/**
 * Resolve Gmail OAuth credentials for a project.
 * Fetches refresh token from integration credentials and exchanges for access token.
 */
async function resolveGmailCredentials(projectId: string): Promise<OAuthEmailCredentials | null> {
	// Get Gmail-specific credentials from integration
	const [gmailEmail, refreshToken] = await Promise.all([
		getIntegrationCredentialOrNull(projectId, 'email', 'gmail_email'),
		getIntegrationCredentialOrNull(projectId, 'email', 'gmail_refresh_token'),
	]);

	if (!gmailEmail || !refreshToken) {
		logger.debug('Gmail credentials not found for project', { projectId });
		return null;
	}

	// Get Google OAuth client credentials from org-level defaults
	const [clientId, clientSecret] = await Promise.all([
		getOrgCredential(projectId, 'GOOGLE_OAUTH_CLIENT_ID'),
		getOrgCredential(projectId, 'GOOGLE_OAUTH_CLIENT_SECRET'),
	]);

	if (!clientId || !clientSecret) {
		logger.warn('Google OAuth client credentials not found at org level', { projectId });
		return null;
	}

	try {
		// Get or refresh access token
		const accessToken = await getGmailAccessToken(clientId, clientSecret, refreshToken, gmailEmail);

		return {
			authMethod: 'oauth',
			imapHost: GMAIL_IMAP_HOST,
			imapPort: GMAIL_IMAP_PORT,
			smtpHost: GMAIL_SMTP_HOST,
			smtpPort: GMAIL_SMTP_PORT,
			email: gmailEmail,
			accessToken,
		};
	} catch (error) {
		logger.error('Failed to get Gmail access token', {
			projectId,
			email: gmailEmail,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/**
 * Resolve email credentials for a project from the database.
 * Automatically detects the provider (imap or gmail) and returns appropriate credentials.
 */
export async function resolveEmailCredentials(projectId: string): Promise<EmailCredentials | null> {
	try {
		// Check which email provider is configured
		const provider = await getIntegrationProvider(projectId, 'email');

		if (!provider) {
			logger.debug('No email integration configured for project', { projectId });
			return null;
		}

		if (provider === 'gmail') {
			return resolveGmailCredentials(projectId);
		}

		// Default to IMAP password auth
		return resolveImapCredentials(projectId);
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
