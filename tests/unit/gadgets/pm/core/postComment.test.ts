import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockPMProvider, createMockWorkItem } from '../../../../helpers/mockPMProvider.js';

const mockProvider = createMockPMProvider();

vi.mock('../../../../../src/pm/index.js', () => ({
	getPMProvider: vi.fn(() => mockProvider),
}));

vi.mock('../../../../../src/backends/progressState.js', () => ({
	readProgressCommentId: vi.fn(() => null),
	clearProgressCommentId: vi.fn(),
}));

vi.mock('../../../../../src/utils/logging.js', () => ({
	logger: {
		warn: vi.fn(),
	},
}));

vi.mock('../../../../../src/utils/runLink.js', () => ({
	buildRunLinkFooterFromEnv: vi.fn(() => ''),
}));

import {
	clearProgressCommentId,
	readProgressCommentId,
} from '../../../../../src/backends/progressState.js';
import { postComment } from '../../../../../src/gadgets/pm/core/postComment.js';
import { logger } from '../../../../../src/utils/logging.js';

const mockReadProgressCommentId = vi.mocked(readProgressCommentId);
const mockClearProgressCommentId = vi.mocked(clearProgressCommentId);
const mockLogger = vi.mocked(logger);

beforeEach(() => {
	mockReadProgressCommentId.mockReturnValue(null);
	mockProvider.getWorkItem.mockResolvedValue(
		createMockWorkItem({
			id: 'item1',
			url: 'https://trello.com/c/item1',
		}),
	);
	mockProvider.getWorkItemUrl.mockReturnValue('https://trello.com/c/item1');
});

describe('postComment', () => {
	it('returns a structured created result when no progress comment exists', async () => {
		mockProvider.addComment.mockResolvedValue('comment-new');

		const result = await postComment('item1', 'Hello world');

		expect(mockProvider.addComment).toHaveBeenCalledWith('item1', 'Hello world');
		expect(result).toMatchObject({
			status: 'created',
			id: 'comment-new',
			workItemId: 'item1',
			workItemUrl: 'https://trello.com/c/item1',
		});
		expect(typeof result.updatedAt).toBe('string');
	});

	it('throws on provider failure (no prose sentinel)', async () => {
		mockProvider.addComment.mockRejectedValue(new Error('Network error'));

		await expect(postComment('item1', 'text')).rejects.toThrow('Network error');
	});

	it('passes multi-line text through unchanged', async () => {
		mockProvider.addComment.mockResolvedValue('comment-multi');

		const text = 'Line 1\n\nLine 2\n\nLine 3';
		await postComment('item1', text);

		expect(mockProvider.addComment).toHaveBeenCalledWith('item1', text);
	});

	it('propagates non-Error thrown values', async () => {
		mockProvider.addComment.mockRejectedValue('string error');

		await expect(postComment('item1', 'text')).rejects.toThrow('string error');
	});

	it('falls back to getWorkItemUrl when read-back fails', async () => {
		mockProvider.addComment.mockResolvedValue('comment-fallback');
		mockProvider.getWorkItem.mockRejectedValue(new Error('Read-back failed'));
		mockProvider.getWorkItemUrl.mockReturnValue('https://fallback.example/item1');

		const result = await postComment('item1', 'text');

		expect(result.status).toBe('created');
		expect(result.workItemUrl).toBe('https://fallback.example/item1');
	});

	describe('progress comment replacement', () => {
		it('returns an updated result when existing progress comment is replaced', async () => {
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
			expect(result).toMatchObject({
				status: 'updated',
				id: 'comment-42',
				workItemId: 'item1',
				workItemUrl: 'https://trello.com/c/item1',
			});
		});

		it('does not update when workItemId does not match progress state', async () => {
			mockReadProgressCommentId.mockReturnValue({
				workItemId: 'other-item',
				commentId: 'comment-42',
			});
			mockProvider.addComment.mockResolvedValue('comment-new');

			const result = await postComment('item1', 'My comment');

			expect(mockProvider.updateComment).not.toHaveBeenCalled();
			expect(mockProvider.addComment).toHaveBeenCalledWith('item1', 'My comment');
			expect(result.status).toBe('created');
			expect(result.id).toBe('comment-new');
		});

		it('falls back to addComment when updateComment fails and surfaces a created result', async () => {
			mockReadProgressCommentId.mockReturnValue({ workItemId: 'item1', commentId: 'comment-42' });
			mockProvider.updateComment.mockRejectedValue(new Error('Comment not found'));
			mockProvider.addComment.mockResolvedValue('comment-new');

			const result = await postComment('item1', 'Final summary');

			expect(mockProvider.updateComment).toHaveBeenCalledWith(
				'item1',
				'comment-42',
				'Final summary',
			);
			expect(mockLogger.warn).toHaveBeenCalledWith(
				'Failed to update progress comment, creating new one',
				expect.objectContaining({
					workItemId: 'item1',
					commentId: 'comment-42',
					error: 'Comment not found',
				}),
			);
			expect(mockProvider.addComment).toHaveBeenCalledWith('item1', 'Final summary');
			expect(mockClearProgressCommentId).toHaveBeenCalled();
			expect(result).toMatchObject({
				status: 'created',
				id: 'comment-new',
				workItemId: 'item1',
				workItemUrl: 'https://trello.com/c/item1',
			});
		});

		it('clears progress state before the fallback addComment runs', async () => {
			mockReadProgressCommentId.mockReturnValue({ workItemId: 'item1', commentId: 'comment-42' });
			mockProvider.updateComment.mockRejectedValue(new Error('gone'));
			mockProvider.addComment.mockResolvedValue('comment-new');

			await postComment('item1', 'text');

			// State is cleared even when update fails
			expect(mockClearProgressCommentId).toHaveBeenCalledTimes(1);
		});
	});
});
