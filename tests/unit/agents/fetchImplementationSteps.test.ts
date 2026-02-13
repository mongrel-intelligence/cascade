import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/trello/client.js', () => ({
	trelloClient: {
		getCardChecklists: vi.fn(),
	},
}));

import { fetchImplementationSteps } from '../../../src/agents/base.js';
import { trelloClient } from '../../../src/trello/client.js';

const mockGetCardChecklists = vi.mocked(trelloClient.getCardChecklists);

describe('fetchImplementationSteps', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('extracts incomplete items from Implementation Steps checklist', async () => {
		mockGetCardChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: '📋 Implementation Steps',
				idCard: 'card1',
				checkItems: [
					{ id: 'ci1', name: 'Add helper function', state: 'incomplete' },
					{ id: 'ci2', name: 'Update prompt template', state: 'incomplete' },
					{ id: 'ci3', name: 'Write tests', state: 'incomplete' },
				],
			},
		]);

		const result = await fetchImplementationSteps('card1');

		expect(result).toEqual(['Add helper function', 'Update prompt template', 'Write tests']);
		expect(mockGetCardChecklists).toHaveBeenCalledWith('card1');
	});

	it('filters out already-complete items', async () => {
		mockGetCardChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: '📋 Implementation Steps',
				idCard: 'card1',
				checkItems: [
					{ id: 'ci1', name: 'Already done step', state: 'complete' },
					{ id: 'ci2', name: 'Remaining step', state: 'incomplete' },
				],
			},
		]);

		const result = await fetchImplementationSteps('card1');

		expect(result).toEqual(['Remaining step']);
	});

	it('returns undefined when all items are complete', async () => {
		mockGetCardChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: '📋 Implementation Steps',
				idCard: 'card1',
				checkItems: [
					{ id: 'ci1', name: 'Done step 1', state: 'complete' },
					{ id: 'ci2', name: 'Done step 2', state: 'complete' },
				],
			},
		]);

		const result = await fetchImplementationSteps('card1');

		expect(result).toBeUndefined();
	});

	it('returns undefined when no Implementation Steps checklist exists', async () => {
		mockGetCardChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: '✅ Acceptance Criteria',
				idCard: 'card1',
				checkItems: [{ id: 'ci1', name: 'Some criterion', state: 'incomplete' }],
			},
		]);

		const result = await fetchImplementationSteps('card1');

		expect(result).toBeUndefined();
	});

	it('returns undefined when checklist has no items', async () => {
		mockGetCardChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: '📋 Implementation Steps',
				idCard: 'card1',
				checkItems: [],
			},
		]);

		const result = await fetchImplementationSteps('card1');

		expect(result).toBeUndefined();
	});

	it('returns undefined when card has no checklists', async () => {
		mockGetCardChecklists.mockResolvedValue([]);

		const result = await fetchImplementationSteps('card1');

		expect(result).toBeUndefined();
	});

	it('returns undefined when API call fails', async () => {
		mockGetCardChecklists.mockRejectedValue(new Error('API error'));

		const result = await fetchImplementationSteps('card1');

		expect(result).toBeUndefined();
	});

	it('matches checklist by substring (handles emoji prefix)', async () => {
		mockGetCardChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: 'Some other checklist',
				idCard: 'card1',
				checkItems: [{ id: 'ci1', name: 'Ignored', state: 'incomplete' }],
			},
			{
				id: 'cl2',
				name: '📋 Implementation Steps (Phase 1)',
				idCard: 'card1',
				checkItems: [{ id: 'ci2', name: 'Phase 1 step', state: 'incomplete' }],
			},
		]);

		const result = await fetchImplementationSteps('card1');

		expect(result).toEqual(['Phase 1 step']);
	});
});
