import { describe, expect, it } from 'vitest';
import {
	AddChecklistToCard,
	CreateTrelloCard,
	GetMyRecentActivity,
	ListTrelloCards,
	PostTrelloComment,
	ReadTrelloCard,
	UpdateTrelloCard,
} from '../../../src/gadgets/trello/index.js';

describe('Trello Gadgets', () => {
	describe('ReadTrelloCard', () => {
		it('is a valid llmist Gadget class', () => {
			const gadget = new ReadTrelloCard();
			expect(gadget).toBeDefined();
			expect(typeof gadget.execute).toBe('function');
		});

		it('has correct metadata', () => {
			const gadget = new ReadTrelloCard();
			expect(gadget.name).toBe('ReadTrelloCard');
			expect(gadget.description).toContain('Trello card');
		});
	});

	describe('PostTrelloComment', () => {
		it('is a valid llmist Gadget class', () => {
			const gadget = new PostTrelloComment();
			expect(gadget).toBeDefined();
			expect(typeof gadget.execute).toBe('function');
		});

		it('has correct metadata', () => {
			const gadget = new PostTrelloComment();
			expect(gadget.name).toBe('PostTrelloComment');
			expect(gadget.description).toContain('comment');
		});
	});

	describe('UpdateTrelloCard', () => {
		it('is a valid llmist Gadget class', () => {
			const gadget = new UpdateTrelloCard();
			expect(gadget).toBeDefined();
			expect(typeof gadget.execute).toBe('function');
		});

		it('has correct metadata', () => {
			const gadget = new UpdateTrelloCard();
			expect(gadget.name).toBe('UpdateTrelloCard');
			expect(gadget.description).toContain('Update');
		});
	});

	describe('CreateTrelloCard', () => {
		it('is a valid llmist Gadget class', () => {
			const gadget = new CreateTrelloCard();
			expect(gadget).toBeDefined();
			expect(typeof gadget.execute).toBe('function');
		});

		it('has correct metadata', () => {
			const gadget = new CreateTrelloCard();
			expect(gadget.name).toBe('CreateTrelloCard');
			expect(gadget.description).toContain('Create');
		});

		it('has user story format in description', () => {
			const gadget = new CreateTrelloCard();
			expect(gadget.description).toContain('user story');
		});
	});

	describe('ListTrelloCards', () => {
		it('is a valid llmist Gadget class', () => {
			const gadget = new ListTrelloCards();
			expect(gadget).toBeDefined();
			expect(typeof gadget.execute).toBe('function');
		});

		it('has correct metadata', () => {
			const gadget = new ListTrelloCards();
			expect(gadget.name).toBe('ListTrelloCards');
			expect(gadget.description).toContain('List');
		});

		it('mentions finding cards in description', () => {
			const gadget = new ListTrelloCards();
			expect(gadget.description).toContain('find cards');
		});
	});

	describe('GetMyRecentActivity', () => {
		it('is a valid llmist Gadget class', () => {
			const gadget = new GetMyRecentActivity();
			expect(gadget).toBeDefined();
			expect(typeof gadget.execute).toBe('function');
		});

		it('has correct metadata', () => {
			const gadget = new GetMyRecentActivity();
			expect(gadget.name).toBe('GetMyRecentActivity');
			expect(gadget.description).toContain('recent');
		});

		it('mentions activity types in description', () => {
			const gadget = new GetMyRecentActivity();
			expect(gadget.description).toContain('created');
			expect(gadget.description).toContain('updated');
		});
	});

	describe('AddChecklistToCard', () => {
		it('is a valid llmist Gadget class', () => {
			const gadget = new AddChecklistToCard();
			expect(gadget).toBeDefined();
			expect(typeof gadget.execute).toBe('function');
		});

		it('has correct metadata', () => {
			const gadget = new AddChecklistToCard();
			expect(gadget.name).toBe('AddChecklistToCard');
			expect(gadget.description).toContain('checklist');
		});

		it('mentions acceptance criteria in description', () => {
			const gadget = new AddChecklistToCard();
			expect(gadget.description).toContain('acceptance criteria');
		});

		it('mentions implementation steps in description', () => {
			const gadget = new AddChecklistToCard();
			expect(gadget.description).toContain('implementation steps');
		});
	});
});
