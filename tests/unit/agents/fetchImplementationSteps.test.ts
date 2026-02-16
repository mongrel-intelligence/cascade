import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(),
}));

import { fetchImplementationSteps } from '../../../src/agents/base.js';
import type { PMProvider } from '../../../src/pm/index.js';
import { getPMProvider } from '../../../src/pm/index.js';

const mockPMProvider = {
	getChecklists: vi.fn(),
};

describe('fetchImplementationSteps', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getPMProvider).mockReturnValue(mockPMProvider as unknown as PMProvider);
	});

	it('extracts incomplete items from Implementation Steps checklist', async () => {
		mockPMProvider.getChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: '📋 Implementation Steps',
				items: [
					{ id: 'ci1', name: 'Add helper function', complete: false },
					{ id: 'ci2', name: 'Update prompt template', complete: false },
					{ id: 'ci3', name: 'Write tests', complete: false },
				],
			},
		]);

		const result = await fetchImplementationSteps('card1');

		expect(result).toEqual(['Add helper function', 'Update prompt template', 'Write tests']);
		expect(mockPMProvider.getChecklists).toHaveBeenCalledWith('card1');
	});

	it('filters out already-complete items', async () => {
		mockPMProvider.getChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: '📋 Implementation Steps',
				items: [
					{ id: 'ci1', name: 'Already done step', complete: true },
					{ id: 'ci2', name: 'Remaining step', complete: false },
				],
			},
		]);

		const result = await fetchImplementationSteps('card1');

		expect(result).toEqual(['Remaining step']);
	});

	it('returns undefined when all items are complete', async () => {
		mockPMProvider.getChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: '📋 Implementation Steps',
				items: [
					{ id: 'ci1', name: 'Done step 1', complete: true },
					{ id: 'ci2', name: 'Done step 2', complete: true },
				],
			},
		]);

		const result = await fetchImplementationSteps('card1');

		expect(result).toBeUndefined();
	});

	it('returns undefined when no Implementation Steps checklist exists', async () => {
		mockPMProvider.getChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: '✅ Acceptance Criteria',
				items: [{ id: 'ci1', name: 'Some criterion', complete: false }],
			},
		]);

		const result = await fetchImplementationSteps('card1');

		expect(result).toBeUndefined();
	});

	it('returns undefined when checklist has no items', async () => {
		mockPMProvider.getChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: '📋 Implementation Steps',
				items: [],
			},
		]);

		const result = await fetchImplementationSteps('card1');

		expect(result).toBeUndefined();
	});

	it('returns undefined when card has no checklists', async () => {
		mockPMProvider.getChecklists.mockResolvedValue([]);

		const result = await fetchImplementationSteps('card1');

		expect(result).toBeUndefined();
	});

	it('returns undefined when API call fails', async () => {
		mockPMProvider.getChecklists.mockRejectedValue(new Error('API error'));

		const result = await fetchImplementationSteps('card1');

		expect(result).toBeUndefined();
	});

	it('matches checklist by substring (handles emoji prefix)', async () => {
		mockPMProvider.getChecklists.mockResolvedValue([
			{
				id: 'cl1',
				name: 'Some other checklist',
				items: [{ id: 'ci1', name: 'Ignored', complete: false }],
			},
			{
				id: 'cl2',
				name: '📋 Implementation Steps (Phase 1)',
				items: [{ id: 'ci2', name: 'Phase 1 step', complete: false }],
			},
		]);

		const result = await fetchImplementationSteps('card1');

		expect(result).toEqual(['Phase 1 step']);
	});
});
