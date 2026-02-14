import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/trello/client.js', () => ({
	trelloClient: {
		addComment: vi.fn(),
	},
}));

vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		updatePRComment: vi.fn(),
	},
}));

vi.mock('../../../src/gadgets/sessionState.js', () => ({
	getSessionState: vi.fn(),
}));

vi.mock('../../../src/config/statusUpdateConfig.js', () => ({
	getStatusUpdateConfig: vi.fn(),
	formatStatusMessage: vi.fn(),
	formatGitHubProgressComment: vi.fn(),
}));

import { createProgressReporter } from '../../../src/backends/progress.js';
import {
	formatGitHubProgressComment,
	formatStatusMessage,
	getStatusUpdateConfig,
} from '../../../src/config/statusUpdateConfig.js';
import { getSessionState } from '../../../src/gadgets/sessionState.js';
import { githubClient } from '../../../src/github/client.js';
import { trelloClient } from '../../../src/trello/client.js';

const mockTrello = vi.mocked(trelloClient);
const mockGithub = vi.mocked(githubClient);
const mockGetStatusConfig = vi.mocked(getStatusUpdateConfig);
const mockFormatStatus = vi.mocked(formatStatusMessage);
const mockFormatGitHub = vi.mocked(formatGitHubProgressComment);
const mockGetSessionState = vi.mocked(getSessionState);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('onIteration — Trello', () => {
	function makeTrelloReporter() {
		const logWriter = vi.fn();
		const reporter = createProgressReporter({
			logWriter,
			trello: { cardId: 'card1', agentType: 'implementation', maxIterations: 20 },
		});
		return { reporter, logWriter };
	}

	it('posts comment at interval multiple', async () => {
		mockGetStatusConfig.mockReturnValue({ enabled: true, intervalIterations: 5 });
		mockFormatStatus.mockReturnValue('Progress: 25%');
		mockTrello.addComment.mockResolvedValue(undefined as never);

		const { reporter } = makeTrelloReporter();
		await reporter.onIteration(5, 20);

		expect(mockTrello.addComment).toHaveBeenCalledWith('card1', 'Progress: 25%');
	});

	it('skips iteration 0', async () => {
		mockGetStatusConfig.mockReturnValue({ enabled: true, intervalIterations: 5 });

		const { reporter } = makeTrelloReporter();
		await reporter.onIteration(0, 20);

		expect(mockTrello.addComment).not.toHaveBeenCalled();
	});

	it('skips when interval not reached', async () => {
		mockGetStatusConfig.mockReturnValue({ enabled: true, intervalIterations: 5 });

		const { reporter } = makeTrelloReporter();
		await reporter.onIteration(3, 20);

		expect(mockTrello.addComment).not.toHaveBeenCalled();
	});

	it('skips when statusConfig.enabled=false', async () => {
		mockGetStatusConfig.mockReturnValue({ enabled: false, intervalIterations: 5 });

		const { reporter } = makeTrelloReporter();
		await reporter.onIteration(5, 20);

		expect(mockTrello.addComment).not.toHaveBeenCalled();
	});

	it('catches and logs Trello API error (does not throw)', async () => {
		mockGetStatusConfig.mockReturnValue({ enabled: true, intervalIterations: 5 });
		mockFormatStatus.mockReturnValue('Progress');
		mockTrello.addComment.mockRejectedValue(new Error('API error'));

		const { reporter, logWriter } = makeTrelloReporter();

		// Should not throw
		await reporter.onIteration(5, 20);

		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			expect.stringContaining('Failed'),
			expect.any(Object),
		);
	});
});

describe('onIteration — GitHub', () => {
	function makeGitHubReporter() {
		const logWriter = vi.fn();
		const reporter = createProgressReporter({
			logWriter,
			github: {
				owner: 'o',
				repo: 'r',
				headerMessage: 'Header',
				agentType: 'review',
				maxIterations: 20,
			},
		});
		return { reporter, logWriter };
	}

	it('updates PR comment at interval multiple', async () => {
		mockGetStatusConfig.mockReturnValue({ enabled: true, intervalIterations: 5 });
		mockGetSessionState.mockReturnValue({
			agentType: 'review',
			prCreated: false,
			prUrl: null,
			reviewSubmitted: false,
			reviewUrl: null,
			initialCommentId: 42,
		});
		mockFormatGitHub.mockReturnValue('GitHub progress');
		mockGithub.updatePRComment.mockResolvedValue(undefined as never);

		const { reporter } = makeGitHubReporter();
		await reporter.onIteration(5, 20);

		expect(mockGithub.updatePRComment).toHaveBeenCalledWith('o', 'r', 42, 'GitHub progress');
	});

	it('skips when no initialCommentId in session state', async () => {
		mockGetStatusConfig.mockReturnValue({ enabled: true, intervalIterations: 5 });
		mockGetSessionState.mockReturnValue({
			agentType: 'review',
			prCreated: false,
			prUrl: null,
			reviewSubmitted: false,
			reviewUrl: null,
			initialCommentId: null,
		});

		const { reporter } = makeGitHubReporter();
		await reporter.onIteration(5, 20);

		expect(mockGithub.updatePRComment).not.toHaveBeenCalled();
	});

	it('skips iteration 0', async () => {
		mockGetStatusConfig.mockReturnValue({ enabled: true, intervalIterations: 5 });

		const { reporter } = makeGitHubReporter();
		await reporter.onIteration(0, 20);

		expect(mockGithub.updatePRComment).not.toHaveBeenCalled();
	});

	it('catches and logs GitHub API error (does not throw)', async () => {
		mockGetStatusConfig.mockReturnValue({ enabled: true, intervalIterations: 5 });
		mockGetSessionState.mockReturnValue({
			agentType: 'review',
			prCreated: false,
			prUrl: null,
			reviewSubmitted: false,
			reviewUrl: null,
			initialCommentId: 42,
		});
		mockFormatGitHub.mockReturnValue('Progress');
		mockGithub.updatePRComment.mockRejectedValue(new Error('Network error'));

		const { reporter, logWriter } = makeGitHubReporter();

		// Should not throw
		await reporter.onIteration(5, 20);

		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			expect.stringContaining('Failed'),
			expect.any(Object),
		);
	});
});

describe('onToolCall', () => {
	it('calls logWriter with DEBUG level', () => {
		const logWriter = vi.fn();
		const reporter = createProgressReporter({ logWriter });

		reporter.onToolCall('ReadTrelloCard', { cardId: 'c1' });

		expect(logWriter).toHaveBeenCalledWith('DEBUG', 'Tool call', {
			toolName: 'ReadTrelloCard',
			params: { cardId: 'c1' },
		});
	});
});

describe('onText', () => {
	it('calls logWriter with DEBUG level and content length', () => {
		const logWriter = vi.fn();
		const reporter = createProgressReporter({ logWriter });

		reporter.onText('Hello world');

		expect(logWriter).toHaveBeenCalledWith('DEBUG', 'Agent text output', { length: 11 });
	});
});
