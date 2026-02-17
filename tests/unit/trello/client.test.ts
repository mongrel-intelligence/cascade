import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
}));

// Mock trello.js client (for other methods, not needed for addActionReaction which uses raw fetch)
vi.mock('trello.js', () => ({
	TrelloClient: vi.fn().mockImplementation(() => ({})),
}));

import { trelloClient, withTrelloCredentials } from '../../../src/trello/client.js';

describe('trelloClient', () => {
	const creds = { apiKey: 'test-key', token: 'test-token' };

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('addActionReaction', () => {
		it('POSTs emoji reaction to Trello action with correct URL and body', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(JSON.stringify({ id: 'reaction-1' }), { status: 200 }));

			const emoji = { shortName: 'thought_balloon', native: '💭', unified: '1f4ad' };

			await withTrelloCredentials(creds, () => trelloClient.addActionReaction('action-123', emoji));

			expect(fetchSpy).toHaveBeenCalledOnce();
			const [url, options] = fetchSpy.mock.calls[0];
			expect(url).toBe(
				'https://api.trello.com/1/actions/action-123/reactions?key=test-key&token=test-token',
			);
			expect(options).toEqual({
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ emoji }),
			});
		});

		it('throws on non-OK response', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Bad Request', { status: 400 }));

			const emoji = { shortName: 'thought_balloon', native: '💭', unified: '1f4ad' };

			await expect(
				withTrelloCredentials(creds, () => trelloClient.addActionReaction('action-123', emoji)),
			).rejects.toThrow('Failed to add reaction to action: 400');
		});

		it('throws when called outside withTrelloCredentials scope', async () => {
			const emoji = { shortName: 'thought_balloon', native: '💭', unified: '1f4ad' };

			await expect(trelloClient.addActionReaction('action-123', emoji)).rejects.toThrow(
				'No Trello credentials in scope',
			);
		});
	});
});
