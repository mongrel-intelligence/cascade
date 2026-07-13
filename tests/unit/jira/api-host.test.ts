import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

// getCloudId() resolves cloudId via a direct `fetch()` — it never instantiates
// Version3Client — so a bare stub keeps the real (heavy) jira.js import out of
// this suite without affecting the code path under test.
vi.mock('jira.js', () => ({
	Version3Client: vi.fn(),
}));

import { resolveJiraApiBaseUrl } from '../../../src/jira/api-host.js';
import { _resetCloudIdCache } from '../../../src/jira/client.js';
import type { JiraCredentials } from '../../../src/jira/types.js';

describe('resolveJiraApiBaseUrl', () => {
	const baseUrl = 'https://acme.atlassian.net';
	const basicCreds: JiraCredentials = {
		email: 'bot@example.com',
		apiToken: 'jira-token',
		baseUrl,
	};
	const expectedAuth = `Basic ${Buffer.from('bot@example.com:jira-token').toString('base64')}`;

	beforeEach(() => {
		_resetCloudIdCache();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('host selection', () => {
		it('returns the site baseUrl when authType is absent (never hits the network)', async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch');

			const result = await resolveJiraApiBaseUrl(basicCreds);

			expect(result).toBe(baseUrl);
			expect(fetchSpy).not.toHaveBeenCalled();
		});

		it('returns the site baseUrl when authType is basic (never hits the network)', async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch');

			const result = await resolveJiraApiBaseUrl({ ...basicCreds, authType: 'basic' });

			expect(result).toBe(baseUrl);
			expect(fetchSpy).not.toHaveBeenCalled();
		});

		it('returns the Atlassian gateway URL for scoped auth', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(
					new Response(JSON.stringify({ cloudId: 'cloud-abc-123' }), { status: 200 }),
				);

			const result = await resolveJiraApiBaseUrl({ ...basicCreds, authType: 'scoped' });

			expect(result).toBe('https://api.atlassian.com/ex/jira/cloud-abc-123');
			// cloudId is discovered via the site /_edge/tenant_info flow with Basic auth.
			expect(fetchSpy).toHaveBeenCalledWith(
				'https://acme.atlassian.net/_edge/tenant_info',
				expect.objectContaining({ headers: { Authorization: expectedAuth } }),
			);
		});
	});

	describe('cloudId caching', () => {
		it('resolves cloudId once and caches it per baseUrl', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(
					new Response(JSON.stringify({ cloudId: 'cloud-abc-123' }), { status: 200 }),
				);

			const scopedCreds: JiraCredentials = { ...basicCreds, authType: 'scoped' };
			const first = await resolveJiraApiBaseUrl(scopedCreds);
			const second = await resolveJiraApiBaseUrl(scopedCreds);

			expect(first).toBe('https://api.atlassian.com/ex/jira/cloud-abc-123');
			expect(second).toBe('https://api.atlassian.com/ex/jira/cloud-abc-123');
			// tenant_info fetched exactly once — the second call is served from cache.
			expect(fetchSpy).toHaveBeenCalledOnce();
		});

		it('resolves cloudId separately for each distinct baseUrl', async () => {
			const globexBaseUrl = 'https://globex.atlassian.net';
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
				const url = String(input);
				const cloudId = url.startsWith(globexBaseUrl) ? 'cloud-globex' : 'cloud-acme';
				return new Response(JSON.stringify({ cloudId }), { status: 200 });
			});

			const acme = await resolveJiraApiBaseUrl({ ...basicCreds, authType: 'scoped' });
			const globex = await resolveJiraApiBaseUrl({
				...basicCreds,
				baseUrl: globexBaseUrl,
				authType: 'scoped',
			});
			// Re-resolving the first tenant must be served from cache (no new fetch).
			const acmeAgain = await resolveJiraApiBaseUrl({ ...basicCreds, authType: 'scoped' });

			expect(acme).toBe('https://api.atlassian.com/ex/jira/cloud-acme');
			expect(globex).toBe('https://api.atlassian.com/ex/jira/cloud-globex');
			expect(acmeAgain).toBe('https://api.atlassian.com/ex/jira/cloud-acme');
			// One fetch per distinct baseUrl (acme + globex); acmeAgain is cached.
			expect(fetchSpy).toHaveBeenCalledTimes(2);
		});
	});
});
