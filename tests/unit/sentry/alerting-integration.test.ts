import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetIntegrationCredential = vi.fn();

vi.mock('../../../src/config/provider.js', () => ({
	getIntegrationCredential: (...args: unknown[]) => mockGetIntegrationCredential(...args),
}));

const mockGetSentryIntegrationConfig = vi.fn();

vi.mock('../../../src/sentry/integration.js', () => ({
	getSentryIntegrationConfig: (...args: unknown[]) => mockGetSentryIntegrationConfig(...args),
}));

import { SentryAlertingIntegration } from '../../../src/sentry/alerting-integration.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SentryAlertingIntegration', () => {
	let integration: SentryAlertingIntegration;

	beforeEach(() => {
		integration = new SentryAlertingIntegration();
		vi.clearAllMocks();
	});

	// =========================================================================
	// Metadata
	// =========================================================================
	describe('metadata', () => {
		it('has type "sentry"', () => {
			expect(integration.type).toBe('sentry');
		});

		it('has category "alerting"', () => {
			expect(integration.category).toBe('alerting');
		});
	});

	// =========================================================================
	// hasIntegration
	// =========================================================================
	describe('hasIntegration', () => {
		it('returns true when sentry integration config is non-null', async () => {
			mockGetSentryIntegrationConfig.mockResolvedValue({ organizationSlug: 'my-org' });

			const result = await integration.hasIntegration('proj-1');

			expect(result).toBe(true);
			expect(mockGetSentryIntegrationConfig).toHaveBeenCalledWith('proj-1');
		});

		it('returns false when sentry integration config is null', async () => {
			mockGetSentryIntegrationConfig.mockResolvedValue(null);

			const result = await integration.hasIntegration('proj-1');

			expect(result).toBe(false);
			expect(mockGetSentryIntegrationConfig).toHaveBeenCalledWith('proj-1');
		});

		it('calls getSentryIntegrationConfig with the correct projectId', async () => {
			mockGetSentryIntegrationConfig.mockResolvedValue(null);

			await integration.hasIntegration('my-project-id');

			expect(mockGetSentryIntegrationConfig).toHaveBeenCalledWith('my-project-id');
		});
	});

	// =========================================================================
	// getConfig
	// =========================================================================
	describe('getConfig', () => {
		it('returns SentryIntegrationConfig when sentry integration is configured', async () => {
			const config = { organizationSlug: 'my-company' };
			mockGetSentryIntegrationConfig.mockResolvedValue(config);

			const result = await integration.getConfig('proj-1');

			expect(result).toEqual({ organizationSlug: 'my-company' });
			expect(mockGetSentryIntegrationConfig).toHaveBeenCalledWith('proj-1');
		});

		it('returns null when sentry integration is not configured', async () => {
			mockGetSentryIntegrationConfig.mockResolvedValue(null);

			const result = await integration.getConfig('proj-1');

			expect(result).toBeNull();
		});

		it('delegates to getSentryIntegrationConfig() with the correct projectId', async () => {
			mockGetSentryIntegrationConfig.mockResolvedValue(null);

			await integration.getConfig('specific-proj-id');

			expect(mockGetSentryIntegrationConfig).toHaveBeenCalledWith('specific-proj-id');
		});
	});

	// =========================================================================
	// withCredentials
	// =========================================================================
	describe('withCredentials', () => {
		it('resolves SENTRY_API_TOKEN from credentials and sets it in process.env', async () => {
			mockGetIntegrationCredential.mockResolvedValue('sentry-token-123');
			const fn = vi.fn().mockResolvedValue('result');

			await integration.withCredentials('proj-1', fn);

			expect(mockGetIntegrationCredential).toHaveBeenCalledWith('proj-1', 'alerting', 'api_token');
			expect(fn).toHaveBeenCalled();
		});

		it('returns the value returned by fn', async () => {
			mockGetIntegrationCredential.mockResolvedValue('sentry-token-123');
			const fn = vi.fn().mockResolvedValue({ data: 42 });

			const result = await integration.withCredentials('proj-1', fn);

			expect(result).toEqual({ data: 42 });
		});

		it('sets SENTRY_API_TOKEN in process.env before calling fn', async () => {
			const token = 'test-sentry-token';
			mockGetIntegrationCredential.mockResolvedValue(token);

			let capturedToken: string | undefined;
			const fn = vi.fn().mockImplementation(async () => {
				capturedToken = process.env.SENTRY_API_TOKEN;
				return 'ok';
			});

			await integration.withCredentials('proj-1', fn);

			expect(capturedToken).toBe(token);
		});

		it('restores the previous SENTRY_API_TOKEN after fn completes', async () => {
			const previousToken = 'previous-token';
			process.env.SENTRY_API_TOKEN = previousToken;

			mockGetIntegrationCredential.mockResolvedValue('new-sentry-token');
			const fn = vi.fn().mockResolvedValue('result');

			await integration.withCredentials('proj-1', fn);

			expect(process.env.SENTRY_API_TOKEN).toBe(previousToken);

			// Cleanup
			process.env.SENTRY_API_TOKEN = undefined;
		});

		it('clears SENTRY_API_TOKEN from process.env when it was not set before', async () => {
			// Ensure the env var is not set (following codebase pattern)
			process.env.SENTRY_API_TOKEN = undefined;
			const previousState = process.env.SENTRY_API_TOKEN;

			mockGetIntegrationCredential.mockResolvedValue('sentry-token-123');
			const fn = vi.fn().mockResolvedValue('result');

			await integration.withCredentials('proj-1', fn);

			// After withCredentials, env var should be restored to its pre-call state
			expect(process.env.SENTRY_API_TOKEN).toBe(previousState);
		});

		it('restores SENTRY_API_TOKEN after fn throws', async () => {
			const previousToken = 'previous-token';
			process.env.SENTRY_API_TOKEN = previousToken;

			mockGetIntegrationCredential.mockResolvedValue('new-sentry-token');
			const fn = vi.fn().mockRejectedValue(new Error('API error'));

			await expect(integration.withCredentials('proj-1', fn)).rejects.toThrow('API error');

			expect(process.env.SENTRY_API_TOKEN).toBe(previousToken);

			// Cleanup
			process.env.SENTRY_API_TOKEN = undefined;
		});

		it('propagates errors from credential resolution without setting env', async () => {
			process.env.SENTRY_API_TOKEN = undefined;
			mockGetIntegrationCredential.mockRejectedValue(new Error('Credential not found'));

			const fn = vi.fn();

			await expect(integration.withCredentials('proj-1', fn)).rejects.toThrow(
				'Credential not found',
			);
			expect(fn).not.toHaveBeenCalled();
		});
	});
});
