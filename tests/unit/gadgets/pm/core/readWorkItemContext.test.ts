import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider, createMockWorkItem } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { readWorkItemContext } from '../../../../../src/gadgets/pm/core/readWorkItemContext.js';

const FROZEN_NOW = new Date('2026-03-15T12:34:56.789Z');

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(FROZEN_NOW);
	vi.clearAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('readWorkItemContext', () => {
	it('returns the provider URL + updatedAt when getWorkItem succeeds', async () => {
		mockProvider.getWorkItem.mockResolvedValue(
			createMockWorkItem({
				id: 'item1',
				url: 'https://trello.com/c/item1',
				updatedAt: '2026-02-01T01:02:03.000Z',
			}),
		);

		const result = await readWorkItemContext('item1');

		expect(result).toEqual({
			workItemUrl: 'https://trello.com/c/item1',
			updatedAt: '2026-02-01T01:02:03.000Z',
		});
	});

	it('synthesises the current ISO timestamp when the provider omits updatedAt', async () => {
		mockProvider.getWorkItem.mockResolvedValue(
			createMockWorkItem({
				id: 'item1',
				url: 'https://trello.com/c/item1',
				updatedAt: undefined,
			}),
		);

		const result = await readWorkItemContext('item1');

		expect(result.updatedAt).toBe(FROZEN_NOW.toISOString());
	});

	it('falls back to getWorkItemUrl + synthesised timestamp when read-back throws', async () => {
		mockProvider.getWorkItem.mockRejectedValue(new Error('Read-back failed'));
		mockProvider.getWorkItemUrl.mockReturnValue('https://fallback.example/item1');

		const result = await readWorkItemContext('item1');

		expect(result).toEqual({
			workItemUrl: 'https://fallback.example/item1',
			updatedAt: FROZEN_NOW.toISOString(),
		});
	});

	it('never propagates the read-back exception (mutation must remain successful)', async () => {
		mockProvider.getWorkItem.mockRejectedValue(new Error('Read-back failed'));
		mockProvider.getWorkItemUrl.mockReturnValue('https://fallback.example/x');

		await expect(readWorkItemContext('x')).resolves.toBeDefined();
	});
});
