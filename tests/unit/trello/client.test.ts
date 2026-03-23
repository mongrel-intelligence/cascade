import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logging.js', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
}));

// Use vi.hoisted to create all mock objects before factory functions run
const { mockCards, mockChecklists, mockLists } = vi.hoisted(() => ({
	mockCards: {
		addCardComment: vi.fn(),
		getCard: vi.fn(),
		getCardActions: vi.fn(),
		updateCard: vi.fn(),
		addCardLabel: vi.fn(),
		deleteCardLabel: vi.fn(),
		createCardAttachment: vi.fn(),
		createCardChecklist: vi.fn(),
		getCardChecklists: vi.fn(),
		updateCardCheckItem: vi.fn(),
		createCard: vi.fn(),
	},
	mockChecklists: {
		createChecklistCheckItems: vi.fn(),
		deleteChecklistCheckItem: vi.fn(),
	},
	mockLists: {
		getListCards: vi.fn(),
	},
}));

// Mock trello.js client
vi.mock('trello.js', () => ({
	TrelloClient: vi.fn().mockImplementation(() => ({
		cards: mockCards,
		checklists: mockChecklists,
		lists: mockLists,
	})),
}));

import { TrelloClient } from 'trello.js';
import { trelloClient, withTrelloCredentials } from '../../../src/trello/client.js';

describe('trelloClient', () => {
	const creds = { apiKey: 'test-key', token: 'test-token' };

	// ===== trelloFetch helper =====

	describe('trelloFetch (via public methods)', () => {
		it('appends key and token to a path without existing query params', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

			await withTrelloCredentials(creds, () => trelloClient.getMe());

			const [url] = fetchSpy.mock.calls[0];
			expect(url).toContain('key=test-key');
			expect(url).toContain('token=test-token');
			// Uses ? separator when no existing query params
			expect(url).toMatch(/\/members\/me\?/);
		});

		it('appends key and token with & when path already has query params', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

			await withTrelloCredentials(creds, () => trelloClient.getBoards());

			const [url] = fetchSpy.mock.calls[0];
			// Path already has ?filter=open, so credentials should be appended with &
			expect(url).toMatch(/filter=open.*key=test-key.*token=test-token/);
		});

		it('throws a Trello API error with status code on non-OK response', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));

			await expect(withTrelloCredentials(creds, () => trelloClient.getMe())).rejects.toThrow(
				'Trello API error 404',
			);
		});

		it('throws when called outside withTrelloCredentials scope', async () => {
			await expect(trelloClient.getMe()).rejects.toThrow('No Trello credentials in scope');
		});

		it('sends PUT request with JSON body for write operations', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

			await withTrelloCredentials(creds, () =>
				trelloClient.updateComment('action-123', 'Updated text'),
			);

			const [, options] = fetchSpy.mock.calls[0];
			expect(options?.method).toBe('PUT');
			expect(options?.headers).toEqual({ 'Content-Type': 'application/json' });
			expect(options?.body).toBe(JSON.stringify({ text: 'Updated text' }));
		});
	});

	// ===== mapLabels utility (tested via card methods) =====

	describe('mapLabels (via getCard / createCard / getListCards)', () => {
		it('maps labels with all fields present', async () => {
			mockCards.getCard.mockResolvedValue({
				id: 'card-1',
				labels: [{ id: 'lbl-1', name: 'Bug', color: 'red' }],
			});

			const result = await withTrelloCredentials(creds, () => trelloClient.getCard('card-1'));

			expect(result.labels).toEqual([{ id: 'lbl-1', name: 'Bug', color: 'red' }]);
		});

		it('returns empty array when labels is undefined', async () => {
			mockCards.getCard.mockResolvedValue({ id: 'card-1' });

			const result = await withTrelloCredentials(creds, () => trelloClient.getCard('card-1'));

			expect(result.labels).toEqual([]);
		});

		it('defaults missing label fields to empty strings', async () => {
			mockCards.getCard.mockResolvedValue({
				id: 'card-1',
				labels: [{}],
			});

			const result = await withTrelloCredentials(creds, () => trelloClient.getCard('card-1'));

			expect(result.labels).toEqual([{ id: '', name: '', color: '' }]);
		});

		it('applies mapLabels consistently across createCard', async () => {
			mockCards.createCard.mockResolvedValue({
				id: 'new-card',
				name: 'New',
				desc: '',
				url: '',
				shortUrl: '',
				idList: 'list-1',
				labels: [{ id: 'lbl-2', name: 'Feature', color: 'green' }],
			});

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.createCard('list-1', { name: 'New' }),
			);

			expect(result.labels).toEqual([{ id: 'lbl-2', name: 'Feature', color: 'green' }]);
		});

		it('applies mapLabels consistently across getListCards', async () => {
			mockLists.getListCards.mockResolvedValue([
				{
					id: 'card-1',
					name: 'Card',
					desc: '',
					url: '',
					shortUrl: '',
					idList: 'list-1',
					labels: [{ id: 'lbl-3', name: 'High Priority', color: 'orange' }],
				},
			]);

			const results = await withTrelloCredentials(creds, () => trelloClient.getListCards('list-1'));

			expect(results[0].labels).toEqual([{ id: 'lbl-3', name: 'High Priority', color: 'orange' }]);
		});
	});

	// ===== Existing tests (unchanged behavior) =====

	describe('addComment', () => {
		it('returns the comment action ID from API response', async () => {
			mockCards.addCardComment.mockResolvedValue({ id: 'action-abc123' });

			const id = await withTrelloCredentials(creds, () =>
				trelloClient.addComment('card-1', 'Hello world'),
			);

			expect(mockCards.addCardComment).toHaveBeenCalledWith({ id: 'card-1', text: 'Hello world' });
			expect(id).toBe('action-abc123');
		});

		it('returns empty string when API response has no id', async () => {
			mockCards.addCardComment.mockResolvedValue({});

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
			).rejects.toThrow('Trello API error 404');
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
			).rejects.toThrow('Trello API error 400');
		});

		it('throws when called outside withTrelloCredentials scope', async () => {
			const emoji = { shortName: 'thought_balloon', native: '💭', unified: '1f4ad' };

			await expect(trelloClient.addActionReaction('action-123', emoji)).rejects.toThrow(
				'No Trello credentials in scope',
			);
		});
	});

	describe('getCard', () => {
		it('returns a card with normalized fields', async () => {
			mockCards.getCard.mockResolvedValue({
				id: 'card-1',
				name: 'My Card',
				desc: 'Card description',
				url: 'https://trello.com/c/abc123',
				shortUrl: 'https://trello.com/c/abc',
				idList: 'list-1',
				labels: [{ id: 'label-1', name: 'Bug', color: 'red' }],
			});

			const result = await withTrelloCredentials(creds, () => trelloClient.getCard('card-1'));

			expect(result).toEqual({
				id: 'card-1',
				name: 'My Card',
				desc: 'Card description',
				url: 'https://trello.com/c/abc123',
				shortUrl: 'https://trello.com/c/abc',
				idList: 'list-1',
				labels: [{ id: 'label-1', name: 'Bug', color: 'red' }],
			});
			expect(mockCards.getCard).toHaveBeenCalledWith({ id: 'card-1' });
		});

		it('normalizes missing optional fields to empty strings', async () => {
			mockCards.getCard.mockResolvedValue({ id: 'card-2' });

			const result = await withTrelloCredentials(creds, () => trelloClient.getCard('card-2'));

			expect(result.name).toBe('');
			expect(result.desc).toBe('');
			expect(result.url).toBe('');
			expect(result.idList).toBe('');
			expect(result.labels).toEqual([]);
		});

		it('throws when called outside scope', async () => {
			await expect(trelloClient.getCard('card-1')).rejects.toThrow(
				'No Trello credentials in scope',
			);
		});
	});

	describe('getCardComments', () => {
		it('returns comments with mapped fields', async () => {
			mockCards.getCardActions.mockResolvedValue([
				{
					id: 'action-1',
					date: '2026-01-01T00:00:00.000Z',
					data: { text: 'Hello world' },
					memberCreator: { id: 'member-1', fullName: 'Alice', username: 'alice' },
				},
			]);

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.getCardComments('card-1'),
			);

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				id: 'action-1',
				date: '2026-01-01T00:00:00.000Z',
				data: { text: 'Hello world' },
				memberCreator: { id: 'member-1', fullName: 'Alice', username: 'alice' },
			});
		});

		it('returns empty array when no comments', async () => {
			mockCards.getCardActions.mockResolvedValue([]);

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.getCardComments('card-1'),
			);

			expect(result).toEqual([]);
		});
	});

	describe('updateCard', () => {
		it('calls updateCard with name and desc', async () => {
			mockCards.updateCard.mockResolvedValue({});

			await withTrelloCredentials(creds, () =>
				trelloClient.updateCard('card-1', { name: 'New Title', desc: 'New desc' }),
			);

			expect(mockCards.updateCard).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'card-1', name: 'New Title', desc: 'New desc' }),
			);
		});
	});

	describe('createCard', () => {
		it('returns a created card with normalized fields', async () => {
			mockCards.createCard.mockResolvedValue({
				id: 'new-card',
				name: 'New Feature',
				desc: 'Description',
				url: 'https://trello.com/c/new',
				shortUrl: 'https://trello.com/c/new-short',
				idList: 'list-todo',
				labels: [],
			});

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.createCard('list-todo', { name: 'New Feature', desc: 'Description' }),
			);

			expect(result.id).toBe('new-card');
			expect(result.name).toBe('New Feature');
			expect(mockCards.createCard).toHaveBeenCalledWith(
				expect.objectContaining({ idList: 'list-todo', name: 'New Feature' }),
			);
		});
	});

	describe('getCardChecklists', () => {
		it('returns checklists with check items', async () => {
			mockCards.getCardChecklists.mockResolvedValue([
				{
					id: 'cl-1',
					name: 'Implementation Steps',
					idCard: 'card-1',
					checkItems: [
						{ id: 'item-1', name: 'Step 1', state: 'complete' },
						{ id: 'item-2', name: 'Step 2', state: 'incomplete' },
					],
				},
			]);

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.getCardChecklists('card-1'),
			);

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('Implementation Steps');
			expect(result[0].checkItems[0].state).toBe('complete');
			expect(result[0].checkItems[1].state).toBe('incomplete');
		});
	});

	describe('deleteChecklistItem', () => {
		it('calls deleteChecklistCheckItem with correct params', async () => {
			mockChecklists.deleteChecklistCheckItem.mockResolvedValue(undefined);

			await withTrelloCredentials(creds, () => trelloClient.deleteChecklistItem('cl-1', 'item-5'));

			expect(mockChecklists.deleteChecklistCheckItem).toHaveBeenCalledWith({
				id: 'cl-1',
				idCheckItem: 'item-5',
			});
		});

		it('throws when called outside scope', async () => {
			await expect(trelloClient.deleteChecklistItem('cl-1', 'item-5')).rejects.toThrow(
				'No Trello credentials in scope',
			);
		});
	});

	describe('getBoards', () => {
		it('returns boards for authenticated member', async () => {
			const boards = [
				{ id: 'board-1', name: 'Board One', url: 'https://trello.com/b/board1' },
				{ id: 'board-2', name: 'Board Two', url: 'https://trello.com/b/board2' },
			];
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(JSON.stringify(boards), { status: 200 }));

			const result = await withTrelloCredentials(creds, () => trelloClient.getBoards());

			expect(result).toEqual(boards);
			expect(fetchSpy).toHaveBeenCalledOnce();
			const [url] = fetchSpy.mock.calls[0];
			expect(url).toContain('/1/members/me/boards');
			expect(url).toContain('filter=open');
			expect(url).toContain('key=test-key');
			expect(url).toContain('token=test-token');
		});

		it('throws on non-OK response', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response('Unauthorized', { status: 401 }),
			);

			await expect(withTrelloCredentials(creds, () => trelloClient.getBoards())).rejects.toThrow(
				'Trello API error 401',
			);
		});

		it('handles missing fields gracefully', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(JSON.stringify([{}, { id: 'b1' }]), { status: 200 }));

			const result = await withTrelloCredentials(creds, () => trelloClient.getBoards());

			expect(result).toEqual([
				{ id: '', name: '', url: '' },
				{ id: 'b1', name: '', url: '' },
			]);
		});
	});

	describe('getBoardLists', () => {
		it('returns lists for a board', async () => {
			const lists = [
				{ id: 'list-1', name: 'Backlog' },
				{ id: 'list-2', name: 'In Progress' },
			];
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(JSON.stringify(lists), { status: 200 }));

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.getBoardLists('board-1'),
			);

			expect(result).toEqual(lists);
			const [url] = fetchSpy.mock.calls[0];
			expect(url).toContain('/1/boards/board-1/lists');
			expect(url).toContain('filter=open');
		});

		it('throws on non-OK response', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));

			await expect(
				withTrelloCredentials(creds, () => trelloClient.getBoardLists('board-1')),
			).rejects.toThrow('Trello API error 404');
		});
	});

	describe('getBoardLabels', () => {
		it('returns labels for a board', async () => {
			const labels = [
				{ id: 'label-1', name: 'Bug', color: 'red' },
				{ id: 'label-2', name: 'Feature', color: 'green' },
			];
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(JSON.stringify(labels), { status: 200 }));

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.getBoardLabels('board-1'),
			);

			expect(result).toEqual(labels);
			const [url] = fetchSpy.mock.calls[0];
			expect(url).toContain('/1/boards/board-1/labels');
		});

		it('throws on non-OK response', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Error', { status: 500 }));

			await expect(
				withTrelloCredentials(creds, () => trelloClient.getBoardLabels('board-1')),
			).rejects.toThrow('Trello API error 500');
		});
	});

	describe('getBoardCustomFields', () => {
		it('returns custom fields for a board', async () => {
			const fields = [
				{ id: 'cf-1', name: 'Priority', type: 'list' },
				{ id: 'cf-2', name: 'Cost', type: 'number' },
			];
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(JSON.stringify(fields), { status: 200 }));

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.getBoardCustomFields('board-1'),
			);

			expect(result).toEqual(fields);
			const [url] = fetchSpy.mock.calls[0];
			expect(url).toContain('/1/boards/board-1/customFields');
		});

		it('throws on non-OK response', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Error', { status: 403 }));

			await expect(
				withTrelloCredentials(creds, () => trelloClient.getBoardCustomFields('board-1')),
			).rejects.toThrow('Trello API error 403');
		});

		it('handles missing fields gracefully', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(JSON.stringify([{}, { id: 'cf-1', type: 'text' }]), { status: 200 }),
			);

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.getBoardCustomFields('board-1'),
			);

			expect(result).toEqual([
				{ id: '', name: '', type: '' },
				{ id: 'cf-1', name: '', type: 'text' },
			]);
		});
	});

	describe('getCardAttachments', () => {
		it('returns attachments via fetch', async () => {
			const attachments = [
				{
					id: 'att-1',
					name: 'session.zip',
					url: 'https://trello.com/attachments/att-1',
					mimeType: 'application/zip',
					bytes: 1024,
					date: '2026-01-01T00:00:00.000Z',
				},
			];
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(JSON.stringify(attachments), { status: 200 }));

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.getCardAttachments('card-1'),
			);

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				id: 'att-1',
				name: 'session.zip',
				url: 'https://trello.com/attachments/att-1',
				mimeType: 'application/zip',
				bytes: 1024,
				date: '2026-01-01T00:00:00.000Z',
			});
			const [url] = fetchSpy.mock.calls[0];
			expect(url).toContain('/1/cards/card-1/attachments');
			expect(url).toContain('key=test-key');
			expect(url).toContain('token=test-token');
		});

		it('throws on non-OK response', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response('Unauthorized', { status: 401 }),
			);

			await expect(
				withTrelloCredentials(creds, () => trelloClient.getCardAttachments('card-1')),
			).rejects.toThrow('Trello API error 401');
		});
	});

	describe('createBoardLabel', () => {
		it('POSTs to the correct endpoint with name and color', async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(JSON.stringify({ id: 'lbl-new', name: 'cascade-processing', color: 'blue' }), {
					status: 200,
				}),
			);

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.createBoardLabel('board-abc', 'cascade-processing', 'blue'),
			);

			expect(result).toEqual({ id: 'lbl-new', name: 'cascade-processing', color: 'blue' });
			const [url, options] = fetchSpy.mock.calls[0];
			expect(url).toContain('/1/boards/board-abc/labels');
			expect(url).toContain('key=test-key');
			expect(url).toContain('token=test-token');
			expect(options?.method).toBe('POST');
			expect(options?.headers).toEqual({ 'Content-Type': 'application/json' });
			expect(options?.body).toBe(JSON.stringify({ name: 'cascade-processing', color: 'blue' }));
		});

		it('defaults color to blue when not provided', async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(JSON.stringify({ id: 'lbl-1', name: 'my-label', color: 'blue' }), {
					status: 200,
				}),
			);

			await withTrelloCredentials(creds, () =>
				trelloClient.createBoardLabel('board-xyz', 'my-label'),
			);

			const [, options] = fetchSpy.mock.calls[0];
			expect(options?.body).toBe(JSON.stringify({ name: 'my-label', color: 'blue' }));
		});

		it('normalizes missing response fields to empty strings', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(JSON.stringify({}), { status: 200 }),
			);

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.createBoardLabel('board-abc', 'my-label'),
			);

			expect(result).toEqual({ id: '', name: '', color: '' });
		});

		it('throws on non-OK response', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Forbidden', { status: 403 }));

			await expect(
				withTrelloCredentials(creds, () =>
					trelloClient.createBoardLabel('board-abc', 'cascade-error', 'red'),
				),
			).rejects.toThrow('Trello API error 403');
		});
	});

	describe('createBoardCustomField', () => {
		it('POSTs to /customFields with boardId, name, type, and pos', async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(JSON.stringify({ id: 'cf-new', name: 'Cost', type: 'number' }), {
					status: 200,
				}),
			);

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.createBoardCustomField('board-abc', 'Cost', 'number'),
			);

			expect(result).toEqual({ id: 'cf-new', name: 'Cost', type: 'number' });
			const [url, options] = fetchSpy.mock.calls[0];
			expect(url).toContain('/1/customFields');
			expect(url).toContain('key=test-key');
			expect(url).toContain('token=test-token');
			expect(options?.method).toBe('POST');
			expect(options?.headers).toEqual({ 'Content-Type': 'application/json' });
			expect(options?.body).toBe(
				JSON.stringify({
					idModel: 'board-abc',
					modelType: 'board',
					name: 'Cost',
					type: 'number',
					pos: 'bottom',
				}),
			);
		});

		it('handles all supported custom field types', async () => {
			const types = ['number', 'text', 'checkbox', 'date', 'list'];

			for (const type of types) {
				const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
					new Response(JSON.stringify({ id: `cf-${type}`, name: 'Test Field', type }), {
						status: 200,
					}),
				);

				const result = await withTrelloCredentials(creds, () =>
					trelloClient.createBoardCustomField('board-1', 'Test Field', type),
				);

				expect(result.type).toBe(type);
				const [, options] = fetchSpy.mock.calls[0];
				expect(JSON.parse(options?.body as string).type).toBe(type);
			}
		});

		it('normalizes missing response fields to empty strings', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(JSON.stringify({}), { status: 200 }),
			);

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.createBoardCustomField('board-abc', 'Cost', 'number'),
			);

			expect(result).toEqual({ id: '', name: '', type: '' });
		});

		it('throws on non-OK response', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Forbidden', { status: 403 }));

			await expect(
				withTrelloCredentials(creds, () =>
					trelloClient.createBoardCustomField('board-abc', 'Cost', 'number'),
				),
			).rejects.toThrow('Trello API error 403');
		});

		it('throws when called outside scope', async () => {
			await expect(
				trelloClient.createBoardCustomField('board-abc', 'Cost', 'number'),
			).rejects.toThrow('No Trello credentials in scope');
		});
	});

	// ===== getCardCustomFieldItems =====

	describe('getCardCustomFieldItems', () => {
		it('returns mapped custom field items with values', async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(
					JSON.stringify([
						{ id: 'cfi-1', idCustomField: 'cf-1', value: { number: '42' } },
						{ id: 'cfi-2', idCustomField: 'cf-2', value: { text: 'hello' } },
					]),
					{ status: 200 },
				),
			);

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.getCardCustomFieldItems('card-1'),
			);

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({ id: 'cfi-1', idCustomField: 'cf-1', value: { number: '42' } });
			expect(result[1]).toEqual({ id: 'cfi-2', idCustomField: 'cf-2', value: { text: 'hello' } });
			const [url] = fetchSpy.mock.calls[0];
			expect(url).toContain('/1/cards/card-1/customFieldItems');
			expect(url).toContain('key=test-key');
			expect(url).toContain('token=test-token');
		});

		it('handles missing fields with defaults (empty strings)', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(JSON.stringify([{}, { id: 'cfi-2' }]), { status: 200 }),
			);

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.getCardCustomFieldItems('card-1'),
			);

			expect(result[0]).toEqual({ id: '', idCustomField: '', value: undefined });
			expect(result[1]).toEqual({ id: 'cfi-2', idCustomField: '', value: undefined });
		});

		it('throws Trello API error with status on non-OK response', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));

			await expect(
				withTrelloCredentials(creds, () => trelloClient.getCardCustomFieldItems('card-1')),
			).rejects.toThrow('Trello API error 404');
		});
	});

	// ===== updateCardCustomFieldNumber =====

	describe('updateCardCustomFieldNumber', () => {
		it('sends PUT with number as string in body', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

			await withTrelloCredentials(creds, () =>
				trelloClient.updateCardCustomFieldNumber('card-1', 'cf-99', 42),
			);

			expect(fetchSpy).toHaveBeenCalledOnce();
			const [, options] = fetchSpy.mock.calls[0];
			expect(options?.method).toBe('PUT');
			expect(options?.headers).toEqual({ 'Content-Type': 'application/json' });
			expect(options?.body).toBe(JSON.stringify({ value: { number: '42' } }));
		});

		it('constructs the correct URL path for the custom field item endpoint', async () => {
			const fetchSpy = vi
				.spyOn(globalThis, 'fetch')
				.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

			await withTrelloCredentials(creds, () =>
				trelloClient.updateCardCustomFieldNumber('card-abc', 'cf-xyz', 7),
			);

			const [url] = fetchSpy.mock.calls[0];
			expect(url).toContain('/1/cards/card-abc/customField/cf-xyz/item');
			expect(url).toContain('key=test-key');
			expect(url).toContain('token=test-token');
		});
	});

	// ===== moveCardToList =====

	describe('moveCardToList', () => {
		it('calls updateCard with idList parameter', async () => {
			mockCards.updateCard.mockResolvedValue({});

			await withTrelloCredentials(creds, () => trelloClient.moveCardToList('card-1', 'list-done'));

			expect(mockCards.updateCard).toHaveBeenCalledWith(
				expect.objectContaining({ idList: 'list-done' }),
			);
		});

		it('passes the correct card ID when moving', async () => {
			mockCards.updateCard.mockResolvedValue({});

			await withTrelloCredentials(creds, () => trelloClient.moveCardToList('card-abc', 'list-xyz'));

			expect(mockCards.updateCard).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'card-abc', idList: 'list-xyz' }),
			);
		});
	});

	// ===== addLabelToCard / removeLabelFromCard =====

	describe('addLabelToCard', () => {
		it('calls addCardLabel with correct id and value (labelId)', async () => {
			mockCards.addCardLabel.mockResolvedValue(undefined);

			await withTrelloCredentials(creds, () => trelloClient.addLabelToCard('card-1', 'label-42'));

			expect(mockCards.addCardLabel).toHaveBeenCalledWith({ id: 'card-1', value: 'label-42' });
		});
	});

	describe('removeLabelFromCard', () => {
		it('calls deleteCardLabel with correct id and idLabel', async () => {
			mockCards.deleteCardLabel.mockResolvedValue(undefined);

			await withTrelloCredentials(creds, () =>
				trelloClient.removeLabelFromCard('card-1', 'label-42'),
			);

			expect(mockCards.deleteCardLabel).toHaveBeenCalledWith({
				id: 'card-1',
				idLabel: 'label-42',
			});
		});
	});

	// ===== addAttachment / addAttachmentFile =====

	describe('addAttachment', () => {
		it('calls createCardAttachment with URL and name', async () => {
			mockCards.createCardAttachment.mockResolvedValue(undefined);

			await withTrelloCredentials(creds, () =>
				trelloClient.addAttachment('card-1', 'https://example.com/file.pdf', 'file.pdf'),
			);

			expect(mockCards.createCardAttachment).toHaveBeenCalledWith({
				id: 'card-1',
				url: 'https://example.com/file.pdf',
				name: 'file.pdf',
			});
		});
	});

	describe('addAttachmentFile', () => {
		it('calls createCardAttachment with buffer, name, and mimeType', async () => {
			mockCards.createCardAttachment.mockResolvedValue(undefined);

			const fileBuffer = Buffer.from('fake-archive-data');

			await withTrelloCredentials(creds, () =>
				trelloClient.addAttachmentFile('card-1', fileBuffer, 'archive.tar.gz', 'application/gzip'),
			);

			expect(mockCards.createCardAttachment).toHaveBeenCalledWith({
				id: 'card-1',
				file: fileBuffer,
				name: 'archive.tar.gz',
				mimeType: 'application/gzip',
			});
		});

		it('uses application/gzip as default mimeType when not provided', async () => {
			mockCards.createCardAttachment.mockResolvedValue(undefined);

			const fileBuffer = Buffer.from('data');

			await withTrelloCredentials(creds, () =>
				trelloClient.addAttachmentFile('card-2', fileBuffer, 'output.gz'),
			);

			expect(mockCards.createCardAttachment).toHaveBeenCalledWith(
				expect.objectContaining({ mimeType: 'application/gzip' }),
			);
		});
	});

	// ===== createChecklist / addChecklistItem / updateChecklistItem =====

	describe('createChecklist', () => {
		it('returns mapped checklist with empty checkItems', async () => {
			mockCards.createCardChecklist.mockResolvedValue({
				id: 'cl-new',
				name: 'My Checklist',
				idCard: 'card-1',
			});

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.createChecklist('card-1', 'My Checklist'),
			);

			expect(result).toEqual({
				id: 'cl-new',
				name: 'My Checklist',
				idCard: 'card-1',
				checkItems: [],
			});
			expect(mockCards.createCardChecklist).toHaveBeenCalledWith({
				id: 'card-1',
				name: 'My Checklist',
			});
		});

		it('defaults missing response fields to empty strings', async () => {
			mockCards.createCardChecklist.mockResolvedValue({});

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.createChecklist('card-1', 'Steps'),
			);

			expect(result).toEqual({ id: '', name: '', idCard: '', checkItems: [] });
		});
	});

	describe('addChecklistItem', () => {
		it('returns mapped check item and defaults checked to false', async () => {
			mockChecklists.createChecklistCheckItems.mockResolvedValue({
				id: 'item-new',
				name: 'Do the thing',
				state: 'incomplete',
			});

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.addChecklistItem('cl-1', 'Do the thing'),
			);

			expect(result).toEqual({ id: 'item-new', name: 'Do the thing', state: 'incomplete' });
			expect(mockChecklists.createChecklistCheckItems).toHaveBeenCalledWith({
				id: 'cl-1',
				name: 'Do the thing',
				checked: false,
			});
		});

		it('maps state "complete" correctly', async () => {
			mockChecklists.createChecklistCheckItems.mockResolvedValue({
				id: 'item-done',
				name: 'Already done',
				state: 'complete',
			});

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.addChecklistItem('cl-1', 'Already done', true),
			);

			expect(result.state).toBe('complete');
		});

		it('maps any non-"complete" state to "incomplete"', async () => {
			mockChecklists.createChecklistCheckItems.mockResolvedValue({
				id: 'item-1',
				name: 'Pending',
				state: 'unknown-state',
			});

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.addChecklistItem('cl-1', 'Pending'),
			);

			expect(result.state).toBe('incomplete');
		});
	});

	describe('updateChecklistItem', () => {
		it('calls updateCardCheckItem with correct cardId, checkItemId, and state', async () => {
			mockCards.updateCardCheckItem.mockResolvedValue(undefined);

			await withTrelloCredentials(creds, () =>
				trelloClient.updateChecklistItem('card-1', 'item-5', 'complete'),
			);

			expect(mockCards.updateCardCheckItem).toHaveBeenCalledWith({
				id: 'card-1',
				idCheckItem: 'item-5',
				state: 'complete',
			});
		});

		it('passes "incomplete" state correctly', async () => {
			mockCards.updateCardCheckItem.mockResolvedValue(undefined);

			await withTrelloCredentials(creds, () =>
				trelloClient.updateChecklistItem('card-2', 'item-9', 'incomplete'),
			);

			expect(mockCards.updateCardCheckItem).toHaveBeenCalledWith({
				id: 'card-2',
				idCheckItem: 'item-9',
				state: 'incomplete',
			});
		});
	});

	// ===== downloadAttachment =====

	describe('downloadAttachment', () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		it('uses OAuth Authorization header (not query params) for auth', async () => {
			const imageBytes = Buffer.from('image-data');
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(imageBytes, {
					status: 200,
					headers: { 'Content-Type': 'image/png' },
				}),
			);

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.downloadAttachment(
					'https://trello.com/1/cards/card123/attachments/att456/download/image.png',
				),
			);

			expect(result).not.toBeNull();
			// biome-ignore lint/style/noNonNullAssertion: guarded by expect above
			expect(result!.mimeType).toBe('image/png');
			// biome-ignore lint/style/noNonNullAssertion: guarded by expect above
			expect(result!.buffer).toBeInstanceOf(Buffer);

			const [url, options] = fetchSpy.mock.calls[0];
			expect(url).not.toContain('key=');
			expect(url).not.toContain('token=');
			expect(options?.headers).toEqual({
				Authorization: 'OAuth oauth_consumer_key="test-key", oauth_token="test-token"',
			});
		});

		it('passes the URL to fetch unchanged (no query params added)', async () => {
			const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(Buffer.from('data'), {
					status: 200,
					headers: { 'Content-Type': 'image/jpeg' },
				}),
			);

			const inputUrl =
				'https://trello.com/1/cards/card123/attachments/att456/download/image.jpg?version=2';

			await withTrelloCredentials(creds, () => trelloClient.downloadAttachment(inputUrl));

			const [url, options] = fetchSpy.mock.calls[0];
			expect(url).toBe(inputUrl);
			expect(options?.headers).toEqual({
				Authorization: 'OAuth oauth_consumer_key="test-key", oauth_token="test-token"',
			});
		});

		it('returns null when download fails (non-OK response)', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response('Unauthorized', { status: 401 }),
			);

			const result = await withTrelloCredentials(creds, () =>
				trelloClient.downloadAttachment(
					'https://trello.com/1/cards/card123/attachments/att456/download/image.png',
				),
			);

			expect(result).toBeNull();
		});

		it('throws when called outside withTrelloCredentials scope', async () => {
			await expect(
				trelloClient.downloadAttachment(
					'https://trello.com/1/cards/card123/attachments/att456/download/image.png',
				),
			).rejects.toThrow('No Trello credentials in scope');
		});
	});
});
