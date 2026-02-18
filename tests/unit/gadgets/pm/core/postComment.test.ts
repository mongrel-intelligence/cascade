import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

import { postComment } from '../../../../../src/gadgets/pm/core/postComment.js';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('postComment', () => {
	it('posts a comment and returns success message', async () => {
		mockProvider.addComment.mockResolvedValue(undefined);

		const result = await postComment('item1', 'Hello world');

		expect(mockProvider.addComment).toHaveBeenCalledWith('item1', 'Hello world');
		expect(result).toBe('Comment posted successfully');
	});

	it('returns error message on failure', async () => {
		mockProvider.addComment.mockRejectedValue(new Error('Network error'));

		const result = await postComment('item1', 'text');

		expect(result).toBe('Error posting comment: Network error');
	});

	it('passes multi-line text correctly', async () => {
		mockProvider.addComment.mockResolvedValue(undefined);

		const text = 'Line 1\n\nLine 2\n\nLine 3';
		await postComment('item1', text);

		expect(mockProvider.addComment).toHaveBeenCalledWith('item1', text);
	});

	it('handles non-Error thrown value', async () => {
		mockProvider.addComment.mockRejectedValue('string error');

		const result = await postComment('item1', 'text');

		expect(result).toBe('Error posting comment: string error');
	});
});
