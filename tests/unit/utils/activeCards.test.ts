import { afterEach, describe, expect, it } from 'vitest';
import {
	clearAllActiveCards,
	clearCardActive,
	getActiveCardCount,
	isCardActive,
	setCardActive,
} from '../../../src/utils/activeCards.js';

describe('activeCards', () => {
	afterEach(() => {
		clearAllActiveCards();
	});

	describe('setCardActive', () => {
		it('marks a card as active', () => {
			setCardActive('card-123');

			expect(isCardActive('card-123')).toBe(true);
		});

		it('can mark multiple cards as active', () => {
			setCardActive('card-1');
			setCardActive('card-2');
			setCardActive('card-3');

			expect(isCardActive('card-1')).toBe(true);
			expect(isCardActive('card-2')).toBe(true);
			expect(isCardActive('card-3')).toBe(true);
		});

		it('is idempotent for the same card', () => {
			setCardActive('card-123');
			setCardActive('card-123');

			expect(getActiveCardCount()).toBe(1);
		});
	});

	describe('isCardActive', () => {
		it('returns false for inactive cards', () => {
			expect(isCardActive('card-123')).toBe(false);
		});

		it('returns true for active cards', () => {
			setCardActive('card-123');

			expect(isCardActive('card-123')).toBe(true);
		});
	});

	describe('clearCardActive', () => {
		it('removes a card from the active set', () => {
			setCardActive('card-123');

			clearCardActive('card-123');

			expect(isCardActive('card-123')).toBe(false);
		});

		it('does not throw for non-existent cards', () => {
			expect(() => clearCardActive('non-existent')).not.toThrow();
		});

		it('only removes the specified card', () => {
			setCardActive('card-1');
			setCardActive('card-2');

			clearCardActive('card-1');

			expect(isCardActive('card-1')).toBe(false);
			expect(isCardActive('card-2')).toBe(true);
		});
	});

	describe('getActiveCardCount', () => {
		it('returns 0 when no cards are active', () => {
			expect(getActiveCardCount()).toBe(0);
		});

		it('tracks the number of active cards', () => {
			setCardActive('card-1');
			expect(getActiveCardCount()).toBe(1);

			setCardActive('card-2');
			expect(getActiveCardCount()).toBe(2);

			clearCardActive('card-1');
			expect(getActiveCardCount()).toBe(1);

			clearCardActive('card-2');
			expect(getActiveCardCount()).toBe(0);
		});
	});

	describe('clearAllActiveCards', () => {
		it('removes all active cards', () => {
			setCardActive('card-1');
			setCardActive('card-2');
			setCardActive('card-3');

			clearAllActiveCards();

			expect(getActiveCardCount()).toBe(0);
			expect(isCardActive('card-1')).toBe(false);
			expect(isCardActive('card-2')).toBe(false);
			expect(isCardActive('card-3')).toBe(false);
		});

		it('allows new cards to be added after clearing', () => {
			setCardActive('old-card');
			clearAllActiveCards();

			setCardActive('new-card');

			expect(isCardActive('new-card')).toBe(true);
			expect(getActiveCardCount()).toBe(1);
		});
	});
});
