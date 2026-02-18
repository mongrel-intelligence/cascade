import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
}));

const { mockAddCardComment } = vi.hoisted(() => ({
	mockAddCardComment: vi.fn(),
}));

// Mock trello.js client
vi.mock('trello.js', () => ({
	TrelloClient: vi.fn().mockImplementation(() => ({
		cards: {
			addCardComment: mockAddCardComment,
		},
	})),
}));

import { TrelloClient } from 'trello.js';
import { trelloClient, withTrelloCredentials } from '../../../src/trello/client.js';

const MockedTrelloClient = vi.mocked(TrelloClient);

describe('trelloClient', () => {
	const creds = { apiKey: 'test-key', token: 'test-token' };

	beforeEach(() => {
		vi.clearAllMocks();
		// Re-initialize the TrelloClient mock implementation after clearAllMocks
		MockedTrelloClient.mockImplementation(
			() => ({ cards: { addCardComment: mockAddCardComment } }) as unknown as TrelloClient,
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('addComment', () => {
		it('returns the comment action ID from API response', async () => {
			mockAddCardComment.mockResolvedValue({ id: 'action-abc123' });

			const id = await withTrelloCredentials(creds, () =>
				trelloClient.addComment('card-1', 'Hello world'),
			);

			expect(mockAddCardComment).toHaveBeenCalledWith({ id: 'card-1', text: 'Hello world' });
			expect(id).toBe('action-abc123');
		});

		it('returns empty string when API response has no id', async () => {
			mockAddCardComment.mockResolvedValue({});

			const id = await withTrelloCredentials(creds, () =>
				trelloClient.addComment('card-1', 'Hello'),
			);

			expect(id).toBe('');
		});
	});

	describe('updateComment', () => {
		it('PUTs text to the action endpoint with correct URL and body', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(JSON.stringify({ id: 'action-123' }), { status: 200 }));

			await withTrelloCredentials(creds, () =>
				trelloClient.updateComment('action-123', 'Updated text'),
			);

			expect(fetchSpy).toHaveBeenCalledOnce();
			const [url, options] = fetchSpy.mock.calls[0];
			expect(url).toBe('https://api.trello.com/1/actions/action-123?key=test-key&token=test-token');
			expect(options).toEqual({
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: 'Updated text' }),
			});
		});

		it('throws on non-OK response', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));

			await expect(
				withTrelloCredentials(creds, () => trelloClient.updateComment('action-123', 'text')),
			).rejects.toThrow('Failed to update comment: 404');
		});

		it('throws when called outside withTrelloCredentials scope', async () => {
			await expect(trelloClient.updateComment('action-123', 'text')).rejects.toThrow(
				'No Trello credentials in scope',
			);
		});
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
