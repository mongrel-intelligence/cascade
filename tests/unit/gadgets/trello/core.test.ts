import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/trello/client.js', () => ({
	trelloClient: {
		getCard: vi.fn(),
		getCardChecklists: vi.fn(),
		getCardAttachments: vi.fn(),
		getCardComments: vi.fn(),
		addComment: vi.fn(),
		updateCard: vi.fn(),
		addLabelToCard: vi.fn(),
		createCard: vi.fn(),
		getListCards: vi.fn(),
		createChecklist: vi.fn(),
		addChecklistItem: vi.fn(),
		updateChecklistItem: vi.fn(),
	},
}));

import { addChecklist } from '../../../../src/gadgets/trello/core/addChecklist.js';
import { createCard } from '../../../../src/gadgets/trello/core/createCard.js';
import { listCards } from '../../../../src/gadgets/trello/core/listCards.js';
import { postComment } from '../../../../src/gadgets/trello/core/postComment.js';
import { readCard } from '../../../../src/gadgets/trello/core/readCard.js';
import { updateCard } from '../../../../src/gadgets/trello/core/updateCard.js';
import { updateChecklistItem } from '../../../../src/gadgets/trello/core/updateChecklistItem.js';
import { trelloClient } from '../../../../src/trello/client.js';

const mockTrello = vi.mocked(trelloClient);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('readCard', () => {
	const mockCard = {
		name: 'Test Card',
		url: 'https://trello.com/c/abc123',
		desc: 'A description',
		labels: [{ name: 'Bug', color: 'red' }],
	};

	it('formats card with title, description, labels, checklists, attachments', async () => {
		mockTrello.getCard.mockResolvedValue(mockCard as ReturnType<typeof mockTrello.getCard>);
		mockTrello.getCardChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: 'Tasks',
				checkItems: [{ id: 'ci1', name: 'Item 1', state: 'incomplete' }],
			},
		] as Awaited<ReturnType<typeof mockTrello.getCardChecklists>>);
		mockTrello.getCardAttachments.mockResolvedValue([
			{ name: 'file.txt', url: 'https://example.com/file.txt', date: '2024-01-01T00:00:00Z' },
		] as Awaited<ReturnType<typeof mockTrello.getCardAttachments>>);
		mockTrello.getCardComments.mockResolvedValue([]);

		const result = await readCard('abc123', false);

		expect(result).toContain('# Test Card');
		expect(result).toContain('A description');
		expect(result).toContain('Bug (red)');
		expect(result).toContain('Tasks');
		expect(result).toContain('[ ] Item 1');
		expect(result).toContain('file.txt');
	});

	it('shows "(No description)" when desc empty', async () => {
		mockTrello.getCard.mockResolvedValue({
			...mockCard,
			desc: '',
		} as ReturnType<typeof mockTrello.getCard>);
		mockTrello.getCardChecklists.mockResolvedValue([]);
		mockTrello.getCardAttachments.mockResolvedValue([]);

		const result = await readCard('abc123', false);

		expect(result).toContain('(No description)');
	});

	it('fetches comments when includeComments=true', async () => {
		mockTrello.getCard.mockResolvedValue(mockCard as ReturnType<typeof mockTrello.getCard>);
		mockTrello.getCardChecklists.mockResolvedValue([]);
		mockTrello.getCardAttachments.mockResolvedValue([]);
		mockTrello.getCardComments.mockResolvedValue([
			{
				date: '2024-01-01T00:00:00Z',
				memberCreator: { fullName: 'John' },
				data: { text: 'Hello world' },
			},
		] as Awaited<ReturnType<typeof mockTrello.getCardComments>>);

		const result = await readCard('abc123', true);

		expect(result).toContain('John');
		expect(result).toContain('Hello world');
		expect(mockTrello.getCardComments).toHaveBeenCalledWith('abc123');
	});

	it('skips comments when includeComments=false', async () => {
		mockTrello.getCard.mockResolvedValue(mockCard as ReturnType<typeof mockTrello.getCard>);
		mockTrello.getCardChecklists.mockResolvedValue([]);
		mockTrello.getCardAttachments.mockResolvedValue([]);

		await readCard('abc123', false);

		expect(mockTrello.getCardComments).not.toHaveBeenCalled();
	});

	it('returns error message on API failure', async () => {
		mockTrello.getCard.mockRejectedValue(new Error('API down'));

		const result = await readCard('abc123');

		expect(result).toBe('Error reading card: API down');
	});
});

describe('postComment', () => {
	it('returns success message', async () => {
		mockTrello.addComment.mockResolvedValue(undefined as never);

		const result = await postComment('card1', 'Hello');

		expect(result).toBe('Comment posted successfully');
		expect(mockTrello.addComment).toHaveBeenCalledWith('card1', 'Hello');
	});

	it('returns error message on failure', async () => {
		mockTrello.addComment.mockRejectedValue(new Error('Network error'));

		const result = await postComment('card1', 'Hello');

		expect(result).toBe('Error posting comment: Network error');
	});
});

describe('updateCard', () => {
	it('returns early when nothing to update', async () => {
		const result = await updateCard({ cardId: 'card1' });

		expect(result).toBe('Nothing to update - provide title, description, or labels');
		expect(mockTrello.updateCard).not.toHaveBeenCalled();
	});

	it('updates title and description', async () => {
		mockTrello.updateCard.mockResolvedValue(undefined as never);

		const result = await updateCard({
			cardId: 'card1',
			title: 'New Title',
			description: 'New Desc',
		});

		expect(mockTrello.updateCard).toHaveBeenCalledWith('card1', {
			name: 'New Title',
			desc: 'New Desc',
		});
		expect(result).toContain('title');
		expect(result).toContain('description');
	});

	it('adds labels', async () => {
		mockTrello.addLabelToCard.mockResolvedValue(undefined as never);

		const result = await updateCard({
			cardId: 'card1',
			addLabelIds: ['label1', 'label2'],
		});

		expect(mockTrello.addLabelToCard).toHaveBeenCalledTimes(2);
		expect(result).toContain('2 label(s)');
	});

	it('returns summary of what was updated', async () => {
		mockTrello.updateCard.mockResolvedValue(undefined as never);
		mockTrello.addLabelToCard.mockResolvedValue(undefined as never);

		const result = await updateCard({
			cardId: 'card1',
			title: 'Title',
			addLabelIds: ['l1'],
		});

		expect(result).toBe('Card updated: title, 1 label(s)');
	});

	it('returns error message on failure', async () => {
		mockTrello.updateCard.mockRejectedValue(new Error('Forbidden'));

		const result = await updateCard({ cardId: 'card1', title: 'New' });

		expect(result).toBe('Error updating card: Forbidden');
	});
});

describe('createCard', () => {
	it('returns success with card name and URL', async () => {
		mockTrello.createCard.mockResolvedValue({
			name: 'My Card',
			shortUrl: 'https://trello.com/c/xyz',
		} as Awaited<ReturnType<typeof mockTrello.createCard>>);

		const result = await createCard({ listId: 'list1', title: 'My Card' });

		expect(result).toBe('Card created successfully: "My Card" - https://trello.com/c/xyz');
	});

	it('returns error message on failure', async () => {
		mockTrello.createCard.mockRejectedValue(new Error('List not found'));

		const result = await createCard({ listId: 'bad', title: 'Test' });

		expect(result).toBe('Error creating card: List not found');
	});
});

describe('listCards', () => {
	it('formats cards with name, ID, URL', async () => {
		mockTrello.getListCards.mockResolvedValue([
			{ id: 'c1', name: 'Card 1', shortUrl: 'https://trello.com/c/1', desc: '' },
			{ id: 'c2', name: 'Card 2', shortUrl: 'https://trello.com/c/2', desc: 'Short desc' },
		] as Awaited<ReturnType<typeof mockTrello.getListCards>>);

		const result = await listCards('list1');

		expect(result).toContain('Cards (2)');
		expect(result).toContain('Card 1');
		expect(result).toContain('c1');
		expect(result).toContain('Card 2');
	});

	it('returns empty message when no cards', async () => {
		mockTrello.getListCards.mockResolvedValue([]);

		const result = await listCards('list1');

		expect(result).toBe('No cards found in this list.');
	});

	it('truncates long descriptions at 100 chars', async () => {
		const longDesc = 'a'.repeat(150);
		mockTrello.getListCards.mockResolvedValue([
			{ id: 'c1', name: 'Card', shortUrl: 'https://trello.com/c/1', desc: longDesc },
		] as Awaited<ReturnType<typeof mockTrello.getListCards>>);

		const result = await listCards('list1');

		expect(result).toContain(`${'a'.repeat(100)}...`);
		expect(result).not.toContain('a'.repeat(101));
	});

	it('returns error message on failure', async () => {
		mockTrello.getListCards.mockRejectedValue(new Error('Board not found'));

		const result = await listCards('list1');

		expect(result).toBe('Error listing cards: Board not found');
	});
});

describe('addChecklist', () => {
	it('creates checklist and adds items', async () => {
		mockTrello.createChecklist.mockResolvedValue({ id: 'cl1' } as Awaited<
			ReturnType<typeof mockTrello.createChecklist>
		>);
		mockTrello.addChecklistItem.mockResolvedValue(undefined as never);

		const result = await addChecklist({
			cardId: 'card1',
			checklistName: 'Tasks',
			items: ['Item 1', 'Item 2'],
		});

		expect(mockTrello.createChecklist).toHaveBeenCalledWith('card1', 'Tasks');
		expect(mockTrello.addChecklistItem).toHaveBeenCalledTimes(2);
		expect(mockTrello.addChecklistItem).toHaveBeenCalledWith('cl1', 'Item 1');
		expect(mockTrello.addChecklistItem).toHaveBeenCalledWith('cl1', 'Item 2');
	});

	it('returns success with item count', async () => {
		mockTrello.createChecklist.mockResolvedValue({ id: 'cl1' } as Awaited<
			ReturnType<typeof mockTrello.createChecklist>
		>);
		mockTrello.addChecklistItem.mockResolvedValue(undefined as never);

		const result = await addChecklist({
			cardId: 'card1',
			checklistName: 'Checklist',
			items: ['A', 'B', 'C'],
		});

		expect(result).toContain('3 items');
	});

	it('returns error message on failure', async () => {
		mockTrello.createChecklist.mockRejectedValue(new Error('Card not found'));

		const result = await addChecklist({
			cardId: 'bad',
			checklistName: 'Tasks',
			items: ['Item'],
		});

		expect(result).toBe('Error adding checklist: Card not found');
	});
});

describe('updateChecklistItem', () => {
	it('returns success for "complete" state', async () => {
		mockTrello.updateChecklistItem.mockResolvedValue(undefined as never);

		const result = await updateChecklistItem('card1', 'ci1', 'complete');

		expect(result).toContain('marked complete');
		expect(mockTrello.updateChecklistItem).toHaveBeenCalledWith('card1', 'ci1', 'complete');
	});

	it('returns success for "incomplete" state', async () => {
		mockTrello.updateChecklistItem.mockResolvedValue(undefined as never);

		const result = await updateChecklistItem('card1', 'ci1', 'incomplete');

		expect(result).toContain('marked incomplete');
	});

	it('returns error message on failure', async () => {
		mockTrello.updateChecklistItem.mockRejectedValue(new Error('Not found'));

		const result = await updateChecklistItem('card1', 'ci1', 'complete');

		expect(result).toBe('Error updating checklist item: Not found');
	});
});
