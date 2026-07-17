/**
 * Unit tests for GitHubProjectsPlatformClient.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../../src/router/platformClients/credentials.js', () => ({
	resolveGitHubProjectsCredentials: vi.fn(),
}));

vi.mock('../../../../src/github-projects/client.js', () => ({
	addCommentToIssue: vi.fn(),
	deleteComment: vi.fn(),
	updateComment: vi.fn(),
	withGitHubProjectsCredentials: vi.fn((_creds: unknown, fn: () => unknown) => fn()),
}));

import * as client from '../../../../src/github-projects/client.js';
import * as credentials from '../../../../src/router/platformClients/credentials.js';
import { GitHubProjectsPlatformClient } from '../../../../src/router/platformClients/github-projects.js';
import { logger } from '../../../../src/utils/logging.js';

const mockLogger = vi.mocked(logger);
const mockResolveCredentials = vi.mocked(credentials.resolveGitHubProjectsCredentials);

beforeEach(() => {
	mockResolveCredentials.mockResolvedValue({ token: 'ghp_test' });
});

describe('GitHubProjectsPlatformClient', () => {
	describe('postComment', () => {
		it('posts a comment and returns the comment id', async () => {
			vi.mocked(client.addCommentToIssue).mockResolvedValue('comment-1');

			const platformClient = new GitHubProjectsPlatformClient('proj1');
			const result = await platformClient.postComment('PVTI_item', 'hello');

			expect(result).toBe('comment-1');
			expect(client.addCommentToIssue).toHaveBeenCalledWith('PVTI_item', 'hello');
			expect(client.withGitHubProjectsCredentials).toHaveBeenCalledWith(
				{ token: 'ghp_test' },
				expect.any(Function),
			);
		});

		it('returns null and logs a warning when credentials are missing', async () => {
			mockResolveCredentials.mockResolvedValue(null);

			const platformClient = new GitHubProjectsPlatformClient('proj1');
			const result = await platformClient.postComment('PVTI_item', 'hello');

			expect(result).toBeNull();
			expect(client.addCommentToIssue).not.toHaveBeenCalled();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Missing GitHub Projects credentials'),
			);
		});

		it('returns null and logs a warning when the underlying call throws', async () => {
			vi.mocked(client.addCommentToIssue).mockRejectedValue(new Error('GraphQL error'));

			const platformClient = new GitHubProjectsPlatformClient('proj1');
			const result = await platformClient.postComment('PVTI_item', 'hello');

			expect(result).toBeNull();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Failed to post GitHub Projects comment'),
				expect.stringContaining('GraphQL error'),
			);
		});
	});

	describe('deleteComment', () => {
		it('deletes the comment via the client', async () => {
			vi.mocked(client.deleteComment).mockResolvedValue(undefined);

			const platformClient = new GitHubProjectsPlatformClient('proj1');
			await platformClient.deleteComment('PVTI_item', 'comment-1');

			expect(client.deleteComment).toHaveBeenCalledWith('comment-1');
		});

		it('silently returns when credentials are missing', async () => {
			mockResolveCredentials.mockResolvedValue(null);

			const platformClient = new GitHubProjectsPlatformClient('proj1');
			await platformClient.deleteComment('PVTI_item', 'comment-1');

			expect(client.deleteComment).not.toHaveBeenCalled();
		});

		it('catches errors from the client and logs a warning', async () => {
			vi.mocked(client.deleteComment).mockRejectedValue(new Error('not found'));

			const platformClient = new GitHubProjectsPlatformClient('proj1');
			await platformClient.deleteComment('PVTI_item', 'comment-1');

			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Failed to delete GitHub Projects comment'),
				expect.stringContaining('not found'),
			);
		});

		it('coerces a numeric commentId to a string', async () => {
			vi.mocked(client.deleteComment).mockResolvedValue(undefined);

			const platformClient = new GitHubProjectsPlatformClient('proj1');
			await platformClient.deleteComment('PVTI_item', 42);

			expect(client.deleteComment).toHaveBeenCalledWith('42');
		});
	});

	describe('updateComment', () => {
		it('updates the comment via the client', async () => {
			vi.mocked(client.updateComment).mockResolvedValue(undefined);

			const platformClient = new GitHubProjectsPlatformClient('proj1');
			await platformClient.updateComment('PVTI_item', 'comment-1', 'edited message');

			expect(client.updateComment).toHaveBeenCalledWith('comment-1', 'edited message');
		});

		it('silently returns when credentials are missing', async () => {
			mockResolveCredentials.mockResolvedValue(null);

			const platformClient = new GitHubProjectsPlatformClient('proj1');
			await platformClient.updateComment('PVTI_item', 'comment-1', 'edited message');

			expect(client.updateComment).not.toHaveBeenCalled();
		});

		it('catches errors from the client and logs a warning', async () => {
			vi.mocked(client.updateComment).mockRejectedValue(new Error('rate limited'));

			const platformClient = new GitHubProjectsPlatformClient('proj1');
			await platformClient.updateComment('PVTI_item', 'comment-1', 'edited message');

			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Failed to update GitHub Projects comment'),
				expect.stringContaining('rate limited'),
			);
		});
	});
});
