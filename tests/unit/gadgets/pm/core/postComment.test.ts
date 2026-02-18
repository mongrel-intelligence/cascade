import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

vi.mock('../../../../../src/backends/progressState.js', () => ({
	readProgressCommentId: vi.fn(() => null),
	clearProgressCommentId: vi.fn(),
}));

import {
	clearProgressCommentId,
	readProgressCommentId,
} from '../../../../../src/backends/progressState.js';
import { postComment } from '../../../../../src/gadgets/pm/core/postComment.js';

const mockReadProgressCommentId = vi.mocked(readProgressCommentId);
const mockClearProgressCommentId = vi.mocked(clearProgressCommentId);

beforeEach(() => {
	vi.clearAllMocks();
	mockReadProgressCommentId.mockReturnValue(null);
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

	describe('progress comment replacement', () => {
		it('updates existing progress comment when state matches workItemId', async () => {
			mockReadProgressCommentId.mockReturnValue({ workItemId: 'item1', commentId: 'comment-42' });
			mockProvider.updateComment.mockResolvedValue(undefined);

			const result = await postComment('item1', 'Final summary');

			expect(mockProvider.updateComment).toHaveBeenCalledWith(
				'item1',
				'comment-42',
				'Final summary',
			);
			expect(mockProvider.addComment).not.toHaveBeenCalled();
			expect(mockClearProgressCommentId).toHaveBeenCalled();
			expect(result).toBe('Comment posted successfully');
		});

		it('does not update when workItemId does not match state', async () => {
			mockReadProgressCommentId.mockReturnValue({
				workItemId: 'other-item',
				commentId: 'comment-42',
			});
			mockProvider.addComment.mockResolvedValue(undefined);

			await postComment('item1', 'My comment');

			expect(mockProvider.updateComment).not.toHaveBeenCalled();
			expect(mockProvider.addComment).toHaveBeenCalledWith('item1', 'My comment');
		});

		it('falls back to addComment when updateComment fails, and clears state', async () => {
			mockReadProgressCommentId.mockReturnValue({ workItemId: 'item1', commentId: 'comment-42' });
			mockProvider.updateComment.mockRejectedValue(new Error('Comment not found'));
			mockProvider.addComment.mockResolvedValue(undefined);

			const result = await postComment('item1', 'Final summary');

			expect(mockProvider.updateComment).toHaveBeenCalledWith(
				'item1',
				'comment-42',
				'Final summary',
			);
			expect(mockProvider.addComment).toHaveBeenCalledWith('item1', 'Final summary');
			expect(mockClearProgressCommentId).toHaveBeenCalled();
			expect(result).toBe('Comment posted successfully');
		});

		it('creates new comment (no state) when no progress comment exists', async () => {
			mockReadProgressCommentId.mockReturnValue(null);
			mockProvider.addComment.mockResolvedValue(undefined);

			const result = await postComment('item1', 'New comment');

			expect(mockProvider.updateComment).not.toHaveBeenCalled();
			expect(mockProvider.addComment).toHaveBeenCalledWith('item1', 'New comment');
			expect(result).toBe('Comment posted successfully');
		});

		it('clears state before fallback so subsequent calls create new comments', async () => {
			mockReadProgressCommentId.mockReturnValue({ workItemId: 'item1', commentId: 'comment-42' });
			mockProvider.updateComment.mockRejectedValue(new Error('gone'));
			mockProvider.addComment.mockResolvedValue(undefined);

			await postComment('item1', 'text');

			// State is cleared even when update fails
			expect(mockClearProgressCommentId).toHaveBeenCalledTimes(1);
		});
	});
});
