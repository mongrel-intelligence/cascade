import { describe, expect, it } from 'vitest';
import {
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
});
