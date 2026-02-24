import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/pm/index.js', () => ({
	getPMProviderOrNull: vi.fn(),
}));

vi.mock('../../../src/backends/progressState.js', () => ({
	writeProgressCommentId: vi.fn(),
	readProgressCommentId: vi.fn(),
	clearProgressCommentId: vi.fn(),
}));

import {
	readProgressCommentId,
	writeProgressCommentId,
} from '../../../src/backends/progressState.js';
import { PMProgressPoster } from '../../../src/backends/progressState/pmPoster.js';
import type { PMProvider } from '../../../src/pm/index.js';
import { getPMProviderOrNull } from '../../../src/pm/index.js';

const mockGetPMProvider = vi.mocked(getPMProviderOrNull);
const mockWriteProgressCommentId = vi.mocked(writeProgressCommentId);
const mockReadProgressCommentId = vi.mocked(readProgressCommentId);
const mockPMProvider = {
	addComment: vi.fn<[string, string], Promise<string>>(),
	updateComment: vi.fn<[string, string, string], Promise<void>>(),
};

beforeEach(() => {
	vi.clearAllMocks();
	// Default: state file exists
	mockReadProgressCommentId.mockReturnValue({ workItemId: 'card1', commentId: 'comment1' });
});

function makePoster(overrides?: Partial<Parameters<typeof PMProgressPoster>[0]>) {
	return new PMProgressPoster({
		agentType: 'implementation',
		cardId: 'card1',
		logWriter: vi.fn(),
		...overrides,
	});
}

describe('PMProgressPoster — getCommentId / setCommentId', () => {
	it('returns null initially', () => {
		const poster = makePoster();
		expect(poster.getCommentId()).toBeNull();
	});

	it('returns the ID set via setCommentId', () => {
		const poster = makePoster();
		poster.setCommentId('preset-id');
		expect(poster.getCommentId()).toBe('preset-id');
	});
});

describe('PMProgressPoster — postInitial()', () => {
	it('does nothing when PM provider is null', async () => {
		mockGetPMProvider.mockReturnValue(null);
		const poster = makePoster();
		await poster.postInitial();
		expect(mockPMProvider.addComment).not.toHaveBeenCalled();
		expect(poster.getCommentId()).toBeNull();
	});

	it('posts the initial message and stores the comment ID', async () => {
		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.addComment.mockResolvedValue('initial-id');
		const poster = makePoster({ agentType: 'implementation' });

		await poster.postInitial();

		expect(mockPMProvider.addComment).toHaveBeenCalledWith(
			'card1',
			'**🚀 Implementing changes** — Writing code, running tests, and preparing a PR...',
		);
		expect(poster.getCommentId()).toBe('initial-id');
	});

	it('uses fallback message for unknown agent types', async () => {
		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.addComment.mockResolvedValue('new-id');
		const poster = makePoster({ agentType: 'future-agent' });

		await poster.postInitial();

		expect(mockPMProvider.addComment).toHaveBeenCalledWith(
			'card1',
			'**🚀 Starting** (future-agent)\n\nWorking on this now. Progress updates will follow...',
		);
	});

	it('writes state file when repoDir is provided', async () => {
		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.addComment.mockResolvedValue('initial-id');
		const poster = makePoster({ repoDir: '/tmp/repo' });

		await poster.postInitial();

		expect(mockWriteProgressCommentId).toHaveBeenCalledWith('/tmp/repo', 'card1', 'initial-id');
	});

	it('does not write state file when repoDir is absent', async () => {
		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.addComment.mockResolvedValue('initial-id');
		const poster = makePoster(); // no repoDir

		await poster.postInitial();

		expect(mockWriteProgressCommentId).not.toHaveBeenCalled();
	});
});

describe('PMProgressPoster — update()', () => {
	it('does nothing when PM provider is null', async () => {
		mockGetPMProvider.mockReturnValue(null);
		const poster = makePoster();
		await poster.update('summary');
		expect(mockPMProvider.addComment).not.toHaveBeenCalled();
	});

	it('creates new comment when no existing comment ID (fallback branch)', async () => {
		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.addComment.mockResolvedValue('tick-id');
		const poster = makePoster({ repoDir: '/tmp/repo' });
		// No initial comment was posted

		await poster.update('First progress update');

		expect(mockPMProvider.addComment).toHaveBeenCalledWith('card1', 'First progress update');
		expect(poster.getCommentId()).toBe('tick-id');
		expect(mockWriteProgressCommentId).toHaveBeenCalledWith('/tmp/repo', 'card1', 'tick-id');
	});

	it('updates existing comment when comment ID is set', async () => {
		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.updateComment.mockResolvedValue(undefined);
		const poster = makePoster();
		poster.setCommentId('existing-id');

		await poster.update('Updated progress');

		expect(mockPMProvider.updateComment).toHaveBeenCalledWith(
			'card1',
			'existing-id',
			'Updated progress',
		);
		expect(mockPMProvider.addComment).not.toHaveBeenCalled();
	});

	it('skips update when state file has been cleared by agent subprocess', async () => {
		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockReadProgressCommentId.mockReturnValue(null); // state file cleared
		const poster = makePoster();
		poster.setCommentId('existing-id');

		await poster.update('Should be skipped');

		expect(mockPMProvider.updateComment).not.toHaveBeenCalled();
		expect(poster.getCommentId()).toBeNull();
	});

	it('falls back to new comment when updateComment throws', async () => {
		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.updateComment.mockRejectedValue(new Error('Comment not found'));
		mockPMProvider.addComment.mockResolvedValue('fallback-id');
		const poster = makePoster({ repoDir: '/tmp/repo' });
		poster.setCommentId('deleted-id');

		await poster.update('Fallback summary');

		expect(mockPMProvider.updateComment).toHaveBeenCalledWith(
			'card1',
			'deleted-id',
			'Fallback summary',
		);
		expect(mockPMProvider.addComment).toHaveBeenCalledWith('card1', 'Fallback summary');
		expect(poster.getCommentId()).toBe('fallback-id');
		expect(mockWriteProgressCommentId).toHaveBeenCalledWith('/tmp/repo', 'card1', 'fallback-id');
	});
});
