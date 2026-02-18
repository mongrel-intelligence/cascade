import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/trello/client.js', () => ({
	trelloClient: {
		getCard: vi.fn(),
		getCardComments: vi.fn(),
		updateCard: vi.fn(),
		addComment: vi.fn(),
		createCard: vi.fn(),
		getListCards: vi.fn(),
		moveCardToList: vi.fn(),
		addLabelToCard: vi.fn(),
		removeLabelFromCard: vi.fn(),
		getCardChecklists: vi.fn(),
		createChecklist: vi.fn(),
		addChecklistItem: vi.fn(),
		updateChecklistItem: vi.fn(),
		getCardAttachments: vi.fn(),
		addAttachment: vi.fn(),
		addAttachmentFile: vi.fn(),
		getCardCustomFieldItems: vi.fn(),
		updateCardCustomFieldNumber: vi.fn(),
		getMe: vi.fn(),
	},
}));

import { TrelloPMProvider } from '../../../../src/pm/trello/adapter.js';
import { trelloClient } from '../../../../src/trello/client.js';

const mockTrello = vi.mocked(trelloClient);
let provider: TrelloPMProvider;

beforeEach(() => {
	vi.clearAllMocks();
	provider = new TrelloPMProvider();
});

describe('TrelloPMProvider', () => {
	it('has type "trello"', () => {
		expect(provider.type).toBe('trello');
	});

	describe('getWorkItem', () => {
		it('maps card fields to WorkItem', async () => {
			mockTrello.getCard.mockResolvedValue({
				id: 'card1',
				name: 'My Card',
				desc: 'Description',
				url: 'https://trello.com/c/card1',
				labels: [{ id: 'l1', name: 'Bug', color: 'red' }],
			} as Awaited<ReturnType<typeof mockTrello.getCard>>);

			const item = await provider.getWorkItem('card1');

			expect(item.id).toBe('card1');
			expect(item.title).toBe('My Card');
			expect(item.description).toBe('Description');
			expect(item.url).toBe('https://trello.com/c/card1');
			expect(item.labels).toEqual([{ id: 'l1', name: 'Bug', color: 'red' }]);
		});

		it('maps card with empty labels', async () => {
			mockTrello.getCard.mockResolvedValue({
				id: 'card1',
				name: 'Card',
				desc: '',
				url: 'https://trello.com/c/card1',
				labels: [],
			} as Awaited<ReturnType<typeof mockTrello.getCard>>);

			const item = await provider.getWorkItem('card1');

			expect(item.labels).toEqual([]);
		});
	});

	describe('getWorkItemComments', () => {
		it('maps comment fields', async () => {
			mockTrello.getCardComments.mockResolvedValue([
				{
					id: 'c1',
					date: '2024-01-01T00:00:00Z',
					data: { text: 'Hello' },
					memberCreator: { id: 'u1', fullName: 'Alice', username: 'alice' },
				},
			] as Awaited<ReturnType<typeof mockTrello.getCardComments>>);

			const comments = await provider.getWorkItemComments('card1');

			expect(comments).toHaveLength(1);
			expect(comments[0].id).toBe('c1');
			expect(comments[0].date).toBe('2024-01-01T00:00:00Z');
			expect(comments[0].text).toBe('Hello');
			expect(comments[0].author.name).toBe('Alice');
			expect(comments[0].author.username).toBe('alice');
		});
	});

	describe('updateWorkItem', () => {
		it('maps title to name and description to desc', async () => {
			mockTrello.updateCard.mockResolvedValue(
				{} as Awaited<ReturnType<typeof mockTrello.updateCard>>,
			);

			await provider.updateWorkItem('card1', { title: 'New Title', description: 'New Desc' });

			expect(mockTrello.updateCard).toHaveBeenCalledWith('card1', {
				name: 'New Title',
				desc: 'New Desc',
			});
		});

		it('passes undefined for unset fields', async () => {
			mockTrello.updateCard.mockResolvedValue(
				{} as Awaited<ReturnType<typeof mockTrello.updateCard>>,
			);

			await provider.updateWorkItem('card1', {});

			expect(mockTrello.updateCard).toHaveBeenCalledWith('card1', {
				name: undefined,
				desc: undefined,
			});
		});
	});

	describe('addComment', () => {
		it('delegates to trelloClient.addComment', async () => {
			mockTrello.addComment.mockResolvedValue(
				{} as Awaited<ReturnType<typeof mockTrello.addComment>>,
			);

			await provider.addComment('card1', 'Hello');

			expect(mockTrello.addComment).toHaveBeenCalledWith('card1', 'Hello');
		});
	});

	describe('createWorkItem', () => {
		it('creates card with correct mapping', async () => {
			mockTrello.createCard.mockResolvedValue({
				id: 'newcard',
				name: 'Feature',
				desc: 'Details',
				url: 'https://trello.com/c/newcard',
				labels: [],
			} as Awaited<ReturnType<typeof mockTrello.createCard>>);

			const item = await provider.createWorkItem({
				containerId: 'list1',
				title: 'Feature',
				description: 'Details',
			});

			expect(mockTrello.createCard).toHaveBeenCalledWith('list1', {
				name: 'Feature',
				desc: 'Details',
				idLabels: undefined,
			});
			expect(item.id).toBe('newcard');
			expect(item.title).toBe('Feature');
		});
	});

	describe('listWorkItems', () => {
		it('maps list cards to WorkItems', async () => {
			mockTrello.getListCards.mockResolvedValue([
				{
					id: 'card1',
					name: 'Card 1',
					desc: 'Desc 1',
					url: 'https://trello.com/c/card1',
					labels: [],
				},
				{
					id: 'card2',
					name: 'Card 2',
					desc: '',
					url: 'https://trello.com/c/card2',
					labels: [{ id: 'l1', name: 'Bug', color: 'red' }],
				},
			] as Awaited<ReturnType<typeof mockTrello.getListCards>>);

			const items = await provider.listWorkItems('list1');

			expect(items).toHaveLength(2);
			expect(items[0].id).toBe('card1');
			expect(items[1].labels).toEqual([{ id: 'l1', name: 'Bug', color: 'red' }]);
		});
	});

	describe('moveWorkItem', () => {
		it('delegates to moveCardToList', async () => {
			mockTrello.moveCardToList.mockResolvedValue(undefined);

			await provider.moveWorkItem('card1', 'list2');

			expect(mockTrello.moveCardToList).toHaveBeenCalledWith('card1', 'list2');
		});
	});

	describe('addLabel / removeLabel', () => {
		it('addLabel delegates to addLabelToCard', async () => {
			mockTrello.addLabelToCard.mockResolvedValue(undefined);

			await provider.addLabel('card1', 'label1');

			expect(mockTrello.addLabelToCard).toHaveBeenCalledWith('card1', 'label1');
		});

		it('removeLabel delegates to removeLabelFromCard', async () => {
			mockTrello.removeLabelFromCard.mockResolvedValue(undefined);

			await provider.removeLabel('card1', 'label1');

			expect(mockTrello.removeLabelFromCard).toHaveBeenCalledWith('card1', 'label1');
		});
	});

	describe('getChecklists', () => {
		it('maps checklists with state to complete boolean', async () => {
			mockTrello.getCardChecklists.mockResolvedValue([
				{
					id: 'cl1',
					name: 'Tasks',
					idCard: 'card1',
					checkItems: [
						{ id: 'ci1', name: 'Item 1', state: 'incomplete' },
						{ id: 'ci2', name: 'Item 2', state: 'complete' },
					],
				},
			] as Awaited<ReturnType<typeof mockTrello.getCardChecklists>>);

			const checklists = await provider.getChecklists('card1');

			expect(checklists).toHaveLength(1);
			expect(checklists[0].id).toBe('cl1');
			expect(checklists[0].name).toBe('Tasks');
			expect(checklists[0].workItemId).toBe('card1');
			expect(checklists[0].items[0].complete).toBe(false);
			expect(checklists[0].items[1].complete).toBe(true);
		});
	});

	describe('createChecklist', () => {
		it('creates and returns checklist with empty items', async () => {
			mockTrello.createChecklist.mockResolvedValue({
				id: 'cl1',
				name: 'New Checklist',
				idCard: 'card1',
				checkItems: [],
			} as Awaited<ReturnType<typeof mockTrello.createChecklist>>);

			const checklist = await provider.createChecklist('card1', 'New Checklist');

			expect(checklist.id).toBe('cl1');
			expect(checklist.items).toEqual([]);
		});
	});

	describe('addChecklistItem', () => {
		it('delegates to trelloClient with checked=false by default', async () => {
			mockTrello.addChecklistItem.mockResolvedValue(undefined);

			await provider.addChecklistItem('cl1', 'New Task');

			expect(mockTrello.addChecklistItem).toHaveBeenCalledWith('cl1', 'New Task', false);
		});

		it('passes checked=true when specified', async () => {
			mockTrello.addChecklistItem.mockResolvedValue(undefined);

			await provider.addChecklistItem('cl1', 'Done Task', true);

			expect(mockTrello.addChecklistItem).toHaveBeenCalledWith('cl1', 'Done Task', true);
		});
	});

	describe('updateChecklistItem', () => {
		it('maps complete=true to "complete"', async () => {
			mockTrello.updateChecklistItem.mockResolvedValue(undefined);

			await provider.updateChecklistItem('card1', 'ci1', true);

			expect(mockTrello.updateChecklistItem).toHaveBeenCalledWith('card1', 'ci1', 'complete');
		});

		it('maps complete=false to "incomplete"', async () => {
			mockTrello.updateChecklistItem.mockResolvedValue(undefined);

			await provider.updateChecklistItem('card1', 'ci1', false);

			expect(mockTrello.updateChecklistItem).toHaveBeenCalledWith('card1', 'ci1', 'incomplete');
		});
	});

	describe('getAttachments', () => {
		it('maps attachment fields', async () => {
			mockTrello.getCardAttachments.mockResolvedValue([
				{
					id: 'a1',
					name: 'file.txt',
					url: 'https://example.com/file.txt',
					mimeType: 'text/plain',
					bytes: 100,
					date: '2024-01-01T00:00:00Z',
				},
			] as Awaited<ReturnType<typeof mockTrello.getCardAttachments>>);

			const attachments = await provider.getAttachments('card1');

			expect(attachments).toHaveLength(1);
			expect(attachments[0].id).toBe('a1');
			expect(attachments[0].name).toBe('file.txt');
			expect(attachments[0].mimeType).toBe('text/plain');
			expect(attachments[0].bytes).toBe(100);
		});
	});

	describe('addAttachment', () => {
		it('delegates to trelloClient.addAttachment', async () => {
			mockTrello.addAttachment.mockResolvedValue(undefined);

			await provider.addAttachment('card1', 'https://example.com', 'doc.pdf');

			expect(mockTrello.addAttachment).toHaveBeenCalledWith(
				'card1',
				'https://example.com',
				'doc.pdf',
			);
		});
	});

	describe('addAttachmentFile', () => {
		it('delegates to trelloClient.addAttachmentFile', async () => {
			mockTrello.addAttachmentFile.mockResolvedValue(undefined);
			const buf = Buffer.from('data');

			await provider.addAttachmentFile('card1', buf, 'file.txt', 'text/plain');

			expect(mockTrello.addAttachmentFile).toHaveBeenCalledWith(
				'card1',
				buf,
				'file.txt',
				'text/plain',
			);
		});
	});

	describe('getCustomFieldNumber', () => {
		it('returns field value as number', async () => {
			mockTrello.getCardCustomFieldItems.mockResolvedValue([
				{ idCustomField: 'field1', value: { number: '42.5' } },
			] as Awaited<ReturnType<typeof mockTrello.getCardCustomFieldItems>>);

			const val = await provider.getCustomFieldNumber('card1', 'field1');

			expect(val).toBe(42.5);
		});

		it('returns 0 when field not found', async () => {
			mockTrello.getCardCustomFieldItems.mockResolvedValue([]);

			const val = await provider.getCustomFieldNumber('card1', 'field1');

			expect(val).toBe(0);
		});
	});

	describe('updateCustomFieldNumber', () => {
		it('delegates to trelloClient', async () => {
			mockTrello.updateCardCustomFieldNumber.mockResolvedValue(undefined);

			await provider.updateCustomFieldNumber('card1', 'field1', 99);

			expect(mockTrello.updateCardCustomFieldNumber).toHaveBeenCalledWith('card1', 'field1', 99);
		});
	});

	describe('getWorkItemUrl', () => {
		it('returns correct trello URL', () => {
			expect(provider.getWorkItemUrl('abc123')).toBe('https://trello.com/c/abc123');
		});
	});

	describe('getAuthenticatedUser', () => {
		it('maps me fields', async () => {
			mockTrello.getMe.mockResolvedValue({
				id: 'u1',
				fullName: 'Alice',
				username: 'alice',
			} as Awaited<ReturnType<typeof mockTrello.getMe>>);

			const user = await provider.getAuthenticatedUser();

			expect(user.id).toBe('u1');
			expect(user.name).toBe('Alice');
			expect(user.username).toBe('alice');
		});
	});
});
