import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
}));

// Mock jira.js Version3Client (for other methods, not needed for raw fetch methods)
vi.mock('jira.js', () => ({
	Version3Client: vi.fn().mockImplementation(() => ({})),
}));

import { _resetCloudIdCache, jiraClient, withJiraCredentials } from '../../../src/jira/client.js';

describe('jiraClient', () => {
	const creds = {
		email: 'bot@example.com',
		apiToken: 'jira-token',
		baseUrl: 'https://jira.example.com',
	};
	const expectedAuth = `Basic ${Buffer.from('bot@example.com:jira-token').toString('base64')}`;

	beforeEach(() => {
		vi.clearAllMocks();
		_resetCloudIdCache();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('getCloudId', () => {
		it('fetches cloud ID from tenant_info endpoint', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(
					new Response(JSON.stringify({ cloudId: 'cloud-abc-123' }), { status: 200 }),
				);

			const result = await withJiraCredentials(creds, () => jiraClient.getCloudId());

			expect(result).toBe('cloud-abc-123');
			expect(fetchSpy).toHaveBeenCalledWith(
				'https://jira.example.com/_edge/tenant_info',
				expect.objectContaining({
					headers: { Authorization: expectedAuth },
				}),
			);
		});

		it('caches cloud ID across calls', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(
					new Response(JSON.stringify({ cloudId: 'cloud-abc-123' }), { status: 200 }),
				);

			await withJiraCredentials(creds, () => jiraClient.getCloudId());
			const second = await withJiraCredentials(creds, () => jiraClient.getCloudId());

			expect(second).toBe('cloud-abc-123');
			// Should only fetch once due to caching
			expect(fetchSpy).toHaveBeenCalledOnce();
		});

		it('throws on non-OK response', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response('Unauthorized', { status: 401 }),
			);

			await expect(withJiraCredentials(creds, () => jiraClient.getCloudId())).rejects.toThrow(
				'Failed to fetch JIRA cloud ID: 401',
			);
		});

		it('throws when response is missing cloudId', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(JSON.stringify({}), { status: 200 }),
			);

			await expect(withJiraCredentials(creds, () => jiraClient.getCloudId())).rejects.toThrow(
				'JIRA tenant_info response missing cloudId',
			);
		});
	});

	describe('addCommentReaction', () => {
		it('PUTs reaction with correct ARI and emoji ID', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				// First call: getCloudId
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ cloudId: 'cloud-xyz' }), { status: 200 }),
				)
				// Second call: the actual reaction PUT
				.mockResolvedValueOnce(new Response('{}', { status: 200 }));

			await withJiraCredentials(creds, () =>
				jiraClient.addCommentReaction('10001', '20001', 'atlassian-thought_balloon'),
			);

			expect(fetchSpy).toHaveBeenCalledTimes(2);

			// Verify the reaction PUT call
			const [url, options] = fetchSpy.mock.calls[1];
			expect(url).toBe(
				'https://jira.example.com/rest/reactions/1.0/reactions/ari%3Acloud%3Ajira%3Acloud-xyz%3Acomment%2F10001%2F20001/atlassian-thought_balloon',
			);
			expect(options).toEqual(
				expect.objectContaining({
					method: 'PUT',
					headers: expect.objectContaining({
						Authorization: expectedAuth,
						'Content-Type': 'application/json',
					}),
				}),
			);
		});

		it('uses cached cloud ID on subsequent calls', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				// First call: getCloudId
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ cloudId: 'cloud-xyz' }), { status: 200 }),
				)
				// Second call: reaction PUT
				.mockResolvedValueOnce(new Response('{}', { status: 200 }))
				// Third call: reaction PUT (no getCloudId — cached)
				.mockResolvedValueOnce(new Response('{}', { status: 200 }));

			await withJiraCredentials(creds, () =>
				jiraClient.addCommentReaction('10001', '20001', 'atlassian-thought_balloon'),
			);
			await withJiraCredentials(creds, () =>
				jiraClient.addCommentReaction('10002', '20002', 'atlassian-thought_balloon'),
			);

			// 1 getCloudId + 2 reaction PUTs = 3 total
			expect(fetchSpy).toHaveBeenCalledTimes(3);
		});

		it('throws on non-OK reaction response', async () => {
			vi.spyOn(globalThis, 'fetch')
				// getCloudId succeeds
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ cloudId: 'cloud-xyz' }), { status: 200 }),
				)
				// reaction PUT fails
				.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

			await expect(
				withJiraCredentials(creds, () =>
					jiraClient.addCommentReaction('10001', '20001', 'atlassian-thought_balloon'),
				),
			).rejects.toThrow('Failed to add JIRA comment reaction: 404');
		});

		it('throws when called outside withJiraCredentials scope', async () => {
			await expect(
				jiraClient.addCommentReaction('10001', '20001', 'atlassian-thought_balloon'),
			).rejects.toThrow('No JIRA credentials in scope');
		});
	});
});
