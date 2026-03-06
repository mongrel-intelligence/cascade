/**
 * Gmail OAuth 2.0 utilities.
 *
 * Provides functions for generating auth URLs, exchanging codes for tokens,
 * and refreshing access tokens.
 */

import { logger } from '../../utils/logging.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Gmail API scopes required for email operations.
 * - gmail.readonly: Read emails
 * - gmail.send: Send emails
 * - gmail.modify: Mark as read, archive, etc.
 */
const GMAIL_SCOPES = [
	'https://mail.google.com/', // Full IMAP/SMTP access
	'https://www.googleapis.com/auth/userinfo.email', // Get email address
];

export interface GmailTokenResponse {
	access_token: string;
	expires_in: number;
	refresh_token?: string;
	scope: string;
	token_type: string;
}

export interface GmailUserInfo {
	email: string;
	verified_email: boolean;
}

/**
 * Generate a Google OAuth 2.0 authorization URL.
 *
 * @param clientId - Google OAuth client ID
 * @param redirectUri - Callback URL after authorization
 * @param state - CSRF protection state parameter
 * @returns Authorization URL to redirect the user to
 */
export function getGmailAuthUrl(clientId: string, redirectUri: string, state: string): string {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: GMAIL_SCOPES.join(' '),
		access_type: 'offline', // Request refresh token
		prompt: 'consent', // Force consent screen to get refresh token
		state,
	});

	return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for access and refresh tokens.
 *
 * @param clientId - Google OAuth client ID
 * @param clientSecret - Google OAuth client secret
 * @param code - Authorization code from the callback
 * @param redirectUri - Same redirect URI used in the auth URL
 * @returns Token response containing access_token and refresh_token
 */
export async function exchangeGmailCode(
	clientId: string,
	clientSecret: string,
	code: string,
	redirectUri: string,
): Promise<GmailTokenResponse> {
	logger.debug('Exchanging Gmail authorization code for tokens');

	const response = await fetch(GOOGLE_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			grant_type: 'authorization_code',
			redirect_uri: redirectUri,
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		logger.error('Failed to exchange Gmail code', { status: response.status, error });
		// Sanitize error message to avoid exposing internal details
		const userMessage = error.includes('invalid_grant')
			? 'Invalid or expired authorization code. Please try again.'
			: 'Failed to exchange authorization code. Please try again.';
		throw new Error(userMessage);
	}

	const tokens = (await response.json()) as GmailTokenResponse;
	logger.debug('Successfully exchanged Gmail code for tokens', {
		hasRefreshToken: !!tokens.refresh_token,
		expiresIn: tokens.expires_in,
	});

	return tokens;
}

/**
 * Refresh an access token using a refresh token.
 *
 * @param clientId - Google OAuth client ID
 * @param clientSecret - Google OAuth client secret
 * @param refreshToken - Refresh token to use
 * @returns New access token and expiry
 */
export async function refreshGmailAccessToken(
	clientId: string,
	clientSecret: string,
	refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
	logger.debug('Refreshing Gmail access token');

	const response = await fetch(GOOGLE_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
			grant_type: 'refresh_token',
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		logger.error('Failed to refresh Gmail access token', { status: response.status, error });
		// Sanitize error message to avoid exposing internal details
		const userMessage = error.includes('invalid_grant')
			? 'Refresh token is invalid or expired. Please re-authorize the account.'
			: 'Failed to refresh access token. Please try again.';
		throw new Error(userMessage);
	}

	const tokens = (await response.json()) as GmailTokenResponse;
	const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

	logger.debug('Successfully refreshed Gmail access token', {
		expiresIn: tokens.expires_in,
	});

	return {
		accessToken: tokens.access_token,
		expiresAt,
	};
}

/**
 * Get the user's email address using an access token.
 *
 * @param accessToken - Valid Gmail access token
 * @returns User's email address
 */
export async function getGmailUserInfo(accessToken: string): Promise<GmailUserInfo> {
	const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	});

	if (!response.ok) {
		const error = await response.text();
		logger.error('Failed to get Gmail user info', { status: response.status, error });
		throw new Error(`Failed to get user info: ${error}`);
	}

	return (await response.json()) as GmailUserInfo;
}

// ============================================================================
// Access token cache (in-memory, per-process)
// ============================================================================

interface CachedToken {
	accessToken: string;
	expiresAt: Date;
}

const tokenCache = new Map<string, CachedToken>();

// Refresh locks to prevent concurrent token refreshes for the same email
const refreshLocks = new Map<string, Promise<string>>();

// Buffer time before expiry to trigger refresh (1 minute)
const EXPIRY_BUFFER_MS = 60 * 1000;

// Maximum cache size for LRU-style eviction
const TOKEN_CACHE_MAX_SIZE = 100;

/**
 * Add token to cache with LRU-style eviction when full.
 */
function cacheAccessToken(email: string, token: CachedToken): void {
	// Evict oldest entry if at capacity
	if (tokenCache.size >= TOKEN_CACHE_MAX_SIZE && !tokenCache.has(email)) {
		const firstKey = tokenCache.keys().next().value;
		if (firstKey) {
			tokenCache.delete(firstKey);
			logger.debug('Evicted oldest token from cache', { evictedEmail: firstKey });
		}
	}
	tokenCache.set(email, token);
}

/**
 * Get an access token for a Gmail account, using cache or refreshing as needed.
 * Uses a refresh lock to prevent concurrent token refreshes for the same email.
 *
 * @param clientId - Google OAuth client ID
 * @param clientSecret - Google OAuth client secret
 * @param refreshToken - Refresh token for the account
 * @param email - Gmail address (used as cache key)
 * @returns Valid access token
 */
export async function getGmailAccessToken(
	clientId: string,
	clientSecret: string,
	refreshToken: string,
	email: string,
): Promise<string> {
	// Check if there's already a refresh in progress for this email
	const existingLock = refreshLocks.get(email);
	if (existingLock) {
		logger.debug('Waiting for existing token refresh', { email });
		return existingLock;
	}

	// Return cached token if valid and not expiring soon
	const cached = tokenCache.get(email);
	if (cached && cached.expiresAt.getTime() > Date.now() + EXPIRY_BUFFER_MS) {
		logger.debug('Using cached Gmail access token', { email });
		return cached.accessToken;
	}

	// Create a refresh promise and store it as a lock
	const refreshPromise = (async () => {
		try {
			const { accessToken, expiresAt } = await refreshGmailAccessToken(
				clientId,
				clientSecret,
				refreshToken,
			);

			cacheAccessToken(email, { accessToken, expiresAt });
			logger.debug('Cached new Gmail access token', { email, expiresAt });

			return accessToken;
		} finally {
			// Always remove the lock when done
			refreshLocks.delete(email);
		}
	})();

	refreshLocks.set(email, refreshPromise);
	return refreshPromise;
}

/**
 * Clear the access token cache for a specific email or all emails.
 */
export function clearGmailTokenCache(email?: string): void {
	if (email) {
		tokenCache.delete(email);
	} else {
		tokenCache.clear();
	}
}
