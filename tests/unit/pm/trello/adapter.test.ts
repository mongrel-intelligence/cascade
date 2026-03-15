import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before imports
const { mockTrelloClient } = vi.hoisted(() => ({
	mockTrelloClient: {
		getCard: vi.fn(),
		getCardComments: vi.fn(),
		updateCard: vi.fn(),
		addComment: vi.fn(),
		updateComment: vi.fn(),
		createCard: vi.fn(),
		getListCards: vi.fn(),
		moveCardToList: vi.fn(),
		addLabelToCard: vi.fn(),
		removeLabelFromCard: vi.fn(),
		getCardChecklists: vi.fn(),
		createChecklist: vi.fn(),
		addChecklistItem: vi.fn(),
		updateChecklistItem: vi.fn(),
		deleteChecklistItem: vi.fn(),
		getCardAttachments: vi.fn(),
		addAttachment: vi.fn(),
		addAttachmentFile: vi.fn(),
		getCardCustomFieldItems: vi.fn(),
		updateCardCustomFieldNumber: vi.fn(),
		getMe: vi.fn(),
	},
}));

vi.mock('../../../../src/trello/client.js', () => ({
	trelloClient: mockTrelloClient,
}));

import { TrelloPMProvider } from '../../../../src/pm/trello/adapter.js';

describe('TrelloPMProvider', () => {
	let provider: TrelloPMProvider;

	beforeEach(() => {
		vi.resetAllMocks();
		provider = new TrelloPMProvider();
	});

	it('has type "trello"', () => {
		expect(provider.type).toBe('trello');
	});

	describe('getWorkItem', () => {
		it('delegates to trelloClient.getCard and maps fields', async () => {
			mockTrelloClient.getCard.mockResolvedValue({
				id: 'card-1',
				name: 'My Card',
				desc: 'Card description',
				url: 'https://trello.com/c/abc123',
				labels: [{ id: 'lbl-1', name: 'Bug', color: 'red' }],
			});

			const result = await provider.getWorkItem('card-1');

			expect(mockTrelloClient.getCard).toHaveBeenCalledWith('card-1');
			expect(result).toEqual({
				id: 'card-1',
				title: 'My Card',
				description: 'Card description',
				url: 'https://trello.com/c/abc123',
				labels: [{ id: 'lbl-1', name: 'Bug', color: 'red' }],
				inlineMedia: undefined,
			});
		});

		it('maps empty labels array', async () => {
			mockTrelloClient.getCard.mockResolvedValue({
				id: 'card-2',
				name: 'No Labels',
				desc: '',
				url: 'https://trello.com/c/xyz',
				labels: [],
			});

			const result = await provider.getWorkItem('card-2');

			expect(result.labels).toEqual([]);
		});

		it('extracts inlineMedia from description markdown images', async () => {
			mockTrelloClient.getCard.mockResolvedValue({
				id: 'card-3',
				name: 'Card with image',
				desc: 'Here is a screenshot: ![screenshot](https://trello.com/1/cards/abc/attachments/xyz/download/shot.png)',
				url: 'https://trello.com/c/abc123',
				idList: 'list-1',
				labels: [],
			});

			const result = await provider.getWorkItem('card-3');

			expect(result.inlineMedia).toHaveLength(1);
			expect(result.inlineMedia?.[0]).toMatchObject({
				url: 'https://trello.com/1/cards/abc/attachments/xyz/download/shot.png',
				mimeType: 'image/png',
				altText: 'screenshot',
				source: 'description',
			});
		});

		it('extracts multiple inlineMedia from description', async () => {
			mockTrelloClient.getCard.mockResolvedValue({
				id: 'card-4',
				name: 'Card with images',
				desc: '![img1](https://example.com/a.jpg)\n\nSome text\n\n![img2](https://example.com/b.gif)',
				url: 'https://trello.com/c/abc123',
				idList: 'list-1',
				labels: [],
			});

			const result = await provider.getWorkItem('card-4');

			expect(result.inlineMedia).toHaveLength(2);
			expect(result.inlineMedia?.[0].source).toBe('description');
			expect(result.inlineMedia?.[1].source).toBe('description');
		});

		it('returns undefined inlineMedia when description has no images', async () => {
			mockTrelloClient.getCard.mockResolvedValue({
				id: 'card-5',
				name: 'Plain text card',
				desc: 'Just plain text, no images here.',
				url: 'https://trello.com/c/abc123',
				idList: 'list-1',
				labels: [],
			});

			const result = await provider.getWorkItem('card-5');

			expect(result.inlineMedia).toBeUndefined();
		});

		it('returns undefined inlineMedia when description is empty', async () => {
			mockTrelloClient.getCard.mockResolvedValue({
				id: 'card-6',
				name: 'Empty desc',
				desc: '',
				url: 'https://trello.com/c/abc123',
				idList: 'list-1',
				labels: [],
			});

			const result = await provider.getWorkItem('card-6');

			expect(result.inlineMedia).toBeUndefined();
		});
	});

	describe('getWorkItemComments', () => {
		it('delegates to trelloClient.getCardComments and maps fields', async () => {
			mockTrelloClient.getCardComments.mockResolvedValue([
				{
					id: 'comment-1',
					date: '2024-01-01T00:00:00.000Z',
					data: { text: 'Hello world' },
					memberCreator: { id: 'member-1', fullName: 'Alice', username: 'alice' },
				},
			]);

			const result = await provider.getWorkItemComments('card-1');

			expect(mockTrelloClient.getCardComments).toHaveBeenCalledWith('card-1');
			expect(result).toEqual([
				{
					id: 'comment-1',
					date: '2024-01-01T00:00:00.000Z',
					text: 'Hello world',
					author: { id: 'member-1', name: 'Alice', username: 'alice' },
					inlineMedia: undefined,
				},
			]);
		});

		it('extracts inlineMedia from comment text with markdown images', async () => {
			mockTrelloClient.getCardComments.mockResolvedValue([
				{
					id: 'comment-2',
					date: '2024-01-02T00:00:00.000Z',
					data: {
						text: 'Here is a screenshot: ![screenshot](https://trello.com/1/cards/abc/attachments/xyz/download/shot.png)',
					},
					memberCreator: { id: 'member-1', fullName: 'Alice', username: 'alice' },
				},
			]);

			const result = await provider.getWorkItemComments('card-1');

			expect(result[0].inlineMedia).toHaveLength(1);
			expect(result[0].inlineMedia?.[0]).toMatchObject({
				url: 'https://trello.com/1/cards/abc/attachments/xyz/download/shot.png',
				mimeType: 'image/png',
				altText: 'screenshot',
				source: 'comment',
			});
		});

		it('returns undefined inlineMedia for comments with no images', async () => {
			mockTrelloClient.getCardComments.mockResolvedValue([
				{
					id: 'comment-3',
					date: '2024-01-03T00:00:00.000Z',
					data: { text: 'Just plain text, no images.' },
					memberCreator: { id: 'member-1', fullName: 'Alice', username: 'alice' },
				},
			]);

			const result = await provider.getWorkItemComments('card-1');

			expect(result[0].inlineMedia).toBeUndefined();
		});

		it('extracts inlineMedia independently for multiple comments', async () => {
			mockTrelloClient.getCardComments.mockResolvedValue([
				{
					id: 'comment-4',
					date: '2024-01-04T00:00:00.000Z',
					data: { text: '![img](https://example.com/img.jpg)' },
					memberCreator: { id: 'member-1', fullName: 'Alice', username: 'alice' },
				},
				{
					id: 'comment-5',
					date: '2024-01-05T00:00:00.000Z',
					data: { text: 'No images here.' },
					memberCreator: { id: 'member-2', fullName: 'Bob', username: 'bob' },
				},
			]);

			const result = await provider.getWorkItemComments('card-1');

			expect(result).toHaveLength(2);
			expect(result[0].inlineMedia).toHaveLength(1);
			expect(result[0].inlineMedia?.[0].source).toBe('comment');
			expect(result[1].inlineMedia).toBeUndefined();
		});

		it('uses "comment" as source for all extracted media references', async () => {
			mockTrelloClient.getCardComments.mockResolvedValue([
				{
					id: 'comment-6',
					date: '2024-01-06T00:00:00.000Z',
					data: {
						text: '![a](https://example.com/a.png) and ![b](https://example.com/b.gif)',
					},
					memberCreator: { id: 'member-1', fullName: 'Alice', username: 'alice' },
				},
			]);

			const result = await provider.getWorkItemComments('card-1');

			expect(result[0].inlineMedia).toHaveLength(2);
			for (const ref of result[0].inlineMedia ?? []) {
				expect(ref.source).toBe('comment');
			}
		});
	});

	describe('updateWorkItem', () => {
		it('delegates to trelloClient.updateCard with name and desc', async () => {
			mockTrelloClient.updateCard.mockResolvedValue(undefined);

			await provider.updateWorkItem('card-1', { title: 'New Title', description: 'New Desc' });

			expect(mockTrelloClient.updateCard).toHaveBeenCalledWith('card-1', {
				name: 'New Title',
				desc: 'New Desc',
			});
		});
	});

	describe('addComment', () => {
		it('delegates to trelloClient.addComment and returns the comment ID', async () => {
			mockTrelloClient.addComment.mockResolvedValue('action-abc123');

			const id = await provider.addComment('card-1', 'Test comment');

			expect(mockTrelloClient.addComment).toHaveBeenCalledWith('card-1', 'Test comment');
			expect(id).toBe('action-abc123');
		});
	});

	describe('updateComment', () => {
		it('delegates to trelloClient.updateComment with actionId', async () => {
			mockTrelloClient.updateComment.mockResolvedValue(undefined);

			await provider.updateComment('card-1', 'action-abc123', 'Updated text');

			expect(mockTrelloClient.updateComment).toHaveBeenCalledWith('action-abc123', 'Updated text');
		});
	});

	describe('createWorkItem', () => {
		it('creates card with correct params and maps response', async () => {
			mockTrelloClient.createCard.mockResolvedValue({
				id: 'new-card',
				name: 'New Feature',
				desc: 'Feature desc',
				url: 'https://trello.com/c/newcard',
				labels: [],
			});

			const result = await provider.createWorkItem({
				containerId: 'list-123',
				title: 'New Feature',
				description: 'Feature desc',
			});

			expect(mockTrelloClient.createCard).toHaveBeenCalledWith('list-123', {
				name: 'New Feature',
				desc: 'Feature desc',
				idLabels: undefined,
			});
			expect(result).toMatchObject({ id: 'new-card', title: 'New Feature' });
		});
	});

	describe('listWorkItems', () => {
		it('delegates to trelloClient.getListCards and maps fields', async () => {
			mockTrelloClient.getListCards.mockResolvedValue([
				{
					id: 'card-a',
					name: 'Card A',
					desc: 'Desc A',
					url: 'https://trello.com/c/a',
					labels: [],
				},
			]);

			const result = await provider.listWorkItems('list-456');

			expect(mockTrelloClient.getListCards).toHaveBeenCalledWith('list-456');
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('card-a');
		});
	});

	describe('moveWorkItem', () => {
		it('delegates to trelloClient.moveCardToList', async () => {
			mockTrelloClient.moveCardToList.mockResolvedValue(undefined);

			await provider.moveWorkItem('card-1', 'list-done');

			expect(mockTrelloClient.moveCardToList).toHaveBeenCalledWith('card-1', 'list-done');
		});
	});

	describe('addLabel', () => {
		it('delegates to trelloClient.addLabelToCard', async () => {
			mockTrelloClient.addLabelToCard.mockResolvedValue(undefined);

			await provider.addLabel('card-1', 'label-red');

			expect(mockTrelloClient.addLabelToCard).toHaveBeenCalledWith('card-1', 'label-red');
		});
	});

	describe('removeLabel', () => {
		it('delegates to trelloClient.removeLabelFromCard', async () => {
			mockTrelloClient.removeLabelFromCard.mockResolvedValue(undefined);

			await provider.removeLabel('card-1', 'label-red');

			expect(mockTrelloClient.removeLabelFromCard).toHaveBeenCalledWith('card-1', 'label-red');
		});
	});

	describe('getChecklists', () => {
		it('maps checklists and items correctly', async () => {
			mockTrelloClient.getCardChecklists.mockResolvedValue([
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

			const result = await provider.getChecklists('card-1');

			expect(result).toEqual([
				{
					id: 'cl-1',
					name: 'Implementation Steps',
					workItemId: 'card-1',
					items: [
						{ id: 'item-1', name: 'Step 1', complete: true },
						{ id: 'item-2', name: 'Step 2', complete: false },
					],
				},
			]);
		});
	});

	describe('createChecklist', () => {
		it('delegates to trelloClient.createChecklist and maps response', async () => {
			mockTrelloClient.createChecklist.mockResolvedValue({
				id: 'cl-new',
				name: 'New Checklist',
				idCard: 'card-1',
				checkItems: [],
			});

			const result = await provider.createChecklist('card-1', 'New Checklist');

			expect(result).toEqual({
				id: 'cl-new',
				name: 'New Checklist',
				workItemId: 'card-1',
				items: [],
			});
		});
	});

	describe('addChecklistItem', () => {
		it('delegates to trelloClient.addChecklistItem', async () => {
			mockTrelloClient.addChecklistItem.mockResolvedValue(undefined);

			await provider.addChecklistItem('cl-1', 'New Item', false);

			expect(mockTrelloClient.addChecklistItem).toHaveBeenCalledWith('cl-1', 'New Item', false);
		});
	});

	describe('updateChecklistItem', () => {
		it('passes "complete" when complete=true', async () => {
			mockTrelloClient.updateChecklistItem.mockResolvedValue(undefined);

			await provider.updateChecklistItem('card-1', 'item-1', true);

			expect(mockTrelloClient.updateChecklistItem).toHaveBeenCalledWith(
				'card-1',
				'item-1',
				'complete',
			);
		});

		it('passes "incomplete" when complete=false', async () => {
			mockTrelloClient.updateChecklistItem.mockResolvedValue(undefined);

			await provider.updateChecklistItem('card-1', 'item-1', false);

			expect(mockTrelloClient.updateChecklistItem).toHaveBeenCalledWith(
				'card-1',
				'item-1',
				'incomplete',
			);
		});
	});

	describe('deleteChecklistItem', () => {
		it('finds the item in checklists and deletes it', async () => {
			mockTrelloClient.getCardChecklists.mockResolvedValue([
				{
					id: 'cl-1',
					name: 'Steps',
					idCard: 'card-1',
					checkItems: [
						{ id: 'item-1', name: 'Step 1', state: 'incomplete' },
						{ id: 'item-2', name: 'Step 2', state: 'incomplete' },
					],
				},
			]);
			mockTrelloClient.deleteChecklistItem.mockResolvedValue(undefined);

			await provider.deleteChecklistItem('card-1', 'item-2');

			expect(mockTrelloClient.getCardChecklists).toHaveBeenCalledWith('card-1');
			expect(mockTrelloClient.deleteChecklistItem).toHaveBeenCalledWith('cl-1', 'item-2');
		});

		it('searches across multiple checklists', async () => {
			mockTrelloClient.getCardChecklists.mockResolvedValue([
				{
					id: 'cl-1',
					name: 'First',
					idCard: 'card-1',
					checkItems: [{ id: 'item-1', name: 'Step 1', state: 'incomplete' }],
				},
				{
					id: 'cl-2',
					name: 'Second',
					idCard: 'card-1',
					checkItems: [{ id: 'item-3', name: 'Step 3', state: 'complete' }],
				},
			]);
			mockTrelloClient.deleteChecklistItem.mockResolvedValue(undefined);

			await provider.deleteChecklistItem('card-1', 'item-3');

			expect(mockTrelloClient.deleteChecklistItem).toHaveBeenCalledWith('cl-2', 'item-3');
		});

		it('throws when item is not found on any checklist', async () => {
			mockTrelloClient.getCardChecklists.mockResolvedValue([
				{
					id: 'cl-1',
					name: 'Steps',
					idCard: 'card-1',
					checkItems: [{ id: 'item-1', name: 'Step 1', state: 'incomplete' }],
				},
			]);

			await expect(provider.deleteChecklistItem('card-1', 'nonexistent')).rejects.toThrow(
				'Checklist item nonexistent not found on card card-1',
			);
		});
	});

	describe('getAttachments', () => {
		it('maps attachment fields correctly', async () => {
			mockTrelloClient.getCardAttachments.mockResolvedValue([
				{
					id: 'att-1',
					name: 'screenshot.png',
					url: 'https://example.com/screenshot.png',
					mimeType: 'image/png',
					bytes: 1024,
					date: '2024-01-01T00:00:00.000Z',
				},
			]);

			const result = await provider.getAttachments('card-1');

			expect(result).toEqual([
				{
					id: 'att-1',
					name: 'screenshot.png',
					url: 'https://example.com/screenshot.png',
					mimeType: 'image/png',
					bytes: 1024,
					date: '2024-01-01T00:00:00.000Z',
				},
			]);
		});
	});

	describe('addAttachment', () => {
		it('delegates to trelloClient.addAttachment', async () => {
			mockTrelloClient.addAttachment.mockResolvedValue(undefined);

			await provider.addAttachment('card-1', 'https://example.com/file.pdf', 'file.pdf');

			expect(mockTrelloClient.addAttachment).toHaveBeenCalledWith(
				'card-1',
				'https://example.com/file.pdf',
				'file.pdf',
			);
		});
	});

	describe('addAttachmentFile', () => {
		it('delegates to trelloClient.addAttachmentFile', async () => {
			mockTrelloClient.addAttachmentFile.mockResolvedValue(undefined);
			const buffer = Buffer.from('file content');

			await provider.addAttachmentFile('card-1', buffer, 'file.txt', 'text/plain');

			expect(mockTrelloClient.addAttachmentFile).toHaveBeenCalledWith(
				'card-1',
				buffer,
				'file.txt',
				'text/plain',
			);
		});
	});

	describe('linkPR', () => {
		it('delegates to trelloClient.addAttachment with prUrl and prTitle', async () => {
			mockTrelloClient.addAttachment.mockResolvedValue(undefined);

			await provider.linkPR('card-1', 'https://github.com/owner/repo/pull/42', 'Pull Request #42');

			expect(mockTrelloClient.addAttachment).toHaveBeenCalledWith(
				'card-1',
				'https://github.com/owner/repo/pull/42',
				'Pull Request #42',
			);
		});
	});

	describe('getCustomFieldNumber', () => {
		it('returns the parsed number from custom field items', async () => {
			mockTrelloClient.getCardCustomFieldItems.mockResolvedValue([
				{ idCustomField: 'field-1', value: { number: '42.5' } },
			]);

			const result = await provider.getCustomFieldNumber('card-1', 'field-1');

			expect(result).toBe(42.5);
		});

		it('returns 0 when field not found', async () => {
			mockTrelloClient.getCardCustomFieldItems.mockResolvedValue([]);

			const result = await provider.getCustomFieldNumber('card-1', 'unknown-field');

			expect(result).toBe(0);
		});
	});

	describe('updateCustomFieldNumber', () => {
		it('delegates to trelloClient.updateCardCustomFieldNumber', async () => {
			mockTrelloClient.updateCardCustomFieldNumber.mockResolvedValue(undefined);

			await provider.updateCustomFieldNumber('card-1', 'field-1', 99);

			expect(mockTrelloClient.updateCardCustomFieldNumber).toHaveBeenCalledWith(
				'card-1',
				'field-1',
				99,
			);
		});
	});

	describe('getWorkItemUrl', () => {
		it('returns a Trello card URL', () => {
			const url = provider.getWorkItemUrl('abc123');
			expect(url).toBe('https://trello.com/c/abc123');
		});
	});

	describe('getAuthenticatedUser', () => {
		it('delegates to trelloClient.getMe and maps fields', async () => {
			mockTrelloClient.getMe.mockResolvedValue({
				id: 'user-1',
				fullName: 'John Doe',
				username: 'johndoe',
			});

			const result = await provider.getAuthenticatedUser();

			expect(result).toEqual({
				id: 'user-1',
				name: 'John Doe',
				username: 'johndoe',
			});
		});
	});
});
