import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProvider = {
	type: 'trello' as const,
	getWorkItem: vi.fn(),
	getChecklists: vi.fn(),
	getAttachments: vi.fn(),
	getWorkItemComments: vi.fn(),
	updateWorkItem: vi.fn(),
	addComment: vi.fn(),
	createWorkItem: vi.fn(),
	listWorkItems: vi.fn(),
	moveWorkItem: vi.fn(),
	addLabel: vi.fn(),
	removeLabel: vi.fn(),
	createChecklist: vi.fn(),
	addChecklistItem: vi.fn(),
	updateChecklistItem: vi.fn(),
	addAttachment: vi.fn(),
	addAttachmentFile: vi.fn(),
	getCustomFieldNumber: vi.fn(),
	updateCustomFieldNumber: vi.fn(),
	getWorkItemUrl: vi.fn(),
	getAuthenticatedUser: vi.fn(),
};

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
