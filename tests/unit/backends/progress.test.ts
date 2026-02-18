import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/pm/index.js', () => ({
	getPMProviderOrNull: vi.fn(),
}));

vi.mock('../../../src/github/client.js', () => ({
	githubClient: {
		updatePRComment: vi.fn(),
	},
}));

vi.mock('../../../src/gadgets/sessionState.js', () => ({
	getSessionState: vi.fn(),
}));

vi.mock('../../../src/gadgets/todo/storage.js', () => ({
	loadTodos: vi.fn(),
}));

vi.mock('../../../src/backends/progressModel.js', () => ({
	callProgressModel: vi.fn(),
}));

vi.mock('../../../src/agents/utils/checklistSync.js', () => ({
	syncCompletedTodosToChecklist: vi.fn(),
}));

vi.mock('../../../src/config/statusUpdateConfig.js', () => ({
	getStatusUpdateConfig: vi.fn(),
	formatStatusMessage: vi.fn(),
	formatGitHubProgressComment: vi.fn(),
}));

vi.mock('../../../src/backends/progressState.js', () => ({
	writeProgressCommentId: vi.fn(),
	clearProgressCommentId: vi.fn(),
}));

import { syncCompletedTodosToChecklist } from '../../../src/agents/utils/checklistSync.js';
import { createProgressMonitor } from '../../../src/backends/progress.js';
import { callProgressModel } from '../../../src/backends/progressModel.js';
import { ProgressMonitor } from '../../../src/backends/progressMonitor.js';
import {
	clearProgressCommentId,
	writeProgressCommentId,
} from '../../../src/backends/progressState.js';
import {
	formatGitHubProgressComment,
	formatStatusMessage,
	getStatusUpdateConfig,
} from '../../../src/config/statusUpdateConfig.js';
import { getSessionState } from '../../../src/gadgets/sessionState.js';
import { loadTodos } from '../../../src/gadgets/todo/storage.js';
import { githubClient } from '../../../src/github/client.js';
import type { PMProvider } from '../../../src/pm/index.js';
import { getPMProviderOrNull } from '../../../src/pm/index.js';

const mockGetPMProvider = vi.mocked(getPMProviderOrNull);
const mockWriteProgressCommentId = vi.mocked(writeProgressCommentId);
const mockClearProgressCommentId = vi.mocked(clearProgressCommentId);
const mockPMProvider = { addComment: vi.fn(), updateComment: vi.fn() };
const mockGithub = vi.mocked(githubClient);
const mockGetStatusConfig = vi.mocked(getStatusUpdateConfig);
const mockFormatStatus = vi.mocked(formatStatusMessage);
const mockFormatGitHub = vi.mocked(formatGitHubProgressComment);
const mockGetSessionState = vi.mocked(getSessionState);
const mockLoadTodos = vi.mocked(loadTodos);
const mockCallProgressModel = vi.mocked(callProgressModel);
const mockSyncChecklist = vi.mocked(syncCompletedTodosToChecklist);

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	mockLoadTodos.mockReturnValue([]);
	mockGetPMProvider.mockReturnValue(null);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('ProgressMonitor — state accumulation', () => {
	function makeMonitor() {
		return new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			trello: { cardId: 'card1' },
		});
	}

	it('accumulates iteration state via onIteration()', async () => {
		const monitor = makeMonitor();
		await monitor.onIteration(3, 20);
		// No assertion on internal state — we verify via tick behavior
	});

	it('accumulates tool calls in ring buffer via onToolCall()', () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
			trello: { cardId: 'card1' },
		});

		// Add 25 tool calls (more than ring buffer max of 20)
		for (let i = 0; i < 25; i++) {
			monitor.onToolCall(`Tool${i}`);
		}

		expect(logWriter).toHaveBeenCalledTimes(25);
		expect(logWriter).toHaveBeenCalledWith('INFO', 'Tool call', expect.any(Object));
	});

	it('logs text output via onText()', () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
		});

		monitor.onText('Hello world');

		expect(logWriter).toHaveBeenCalledWith('INFO', 'Agent text output', { length: 11 });
	});
});

describe('ProgressMonitor — timer lifecycle', () => {
	it('start() begins the interval timer', () => {
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
		});

		monitor.start();
		// Timer is running — advancing time would trigger tick
		monitor.stop();
	});

	it('stop() clears the timer', () => {
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
		});

		monitor.start();
		monitor.stop();
		// No tick should fire after stop
	});

	it('start() is idempotent', () => {
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
		});

		monitor.start();
		monitor.start(); // Should not create a second timer
		monitor.stop();
	});
});

describe('ProgressMonitor — tick behavior', () => {
	it('posts initial comment immediately on start()', async () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.addComment.mockResolvedValue('comment-id-initial');

		monitor.start();
		// Flush the microtask queue so the initial comment promise resolves
		await vi.advanceTimersByTimeAsync(0);

		expect(mockPMProvider.addComment).toHaveBeenCalledWith(
			'card1',
			'**🚀 Starting** (implementation)\n\nWorking on this now. Progress updates will follow...',
		);
		expect(logWriter).toHaveBeenCalledWith(
			'INFO',
			'Posted initial progress comment to work item',
			expect.objectContaining({ cardId: 'card1', commentId: 'comment-id-initial' }),
		);
		monitor.stop();
	});

	it('first tick updates initial comment (not creates new)', async () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockCallProgressModel.mockResolvedValue('**Progress**: All good');
		mockPMProvider.addComment.mockResolvedValue('comment-id-1');
		mockPMProvider.updateComment.mockResolvedValue(undefined);

		monitor.start();
		// First tick — should update the comment created at start()
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

		// addComment called once only (for initial comment at start())
		expect(mockPMProvider.addComment).toHaveBeenCalledTimes(1);
		// First tick updates the existing comment
		expect(mockPMProvider.updateComment).toHaveBeenCalledTimes(1);
		expect(mockPMProvider.updateComment).toHaveBeenCalledWith(
			'card1',
			'comment-id-1',
			'**Progress**: All good',
		);
	});

	it('handles failure of initial comment gracefully (does not crash)', async () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.addComment.mockRejectedValue(new Error('API error on initial'));

		monitor.start();
		await vi.advanceTimersByTimeAsync(0);

		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			'Failed to post initial progress comment',
			expect.any(Object),
		);
		monitor.stop();
	});

	it('no crash when PM provider is null on start()', async () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(null);

		// Should not throw
		monitor.start();
		await vi.advanceTimersByTimeAsync(0);

		expect(mockPMProvider.addComment).not.toHaveBeenCalled();
		monitor.stop();
	});

	it('calls progress model and posts to Trello on first tick (updates existing comment)', async () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockCallProgressModel.mockResolvedValue('**Progress**: All good');
		mockPMProvider.addComment.mockResolvedValue('comment-id-1');
		mockPMProvider.updateComment.mockResolvedValue(undefined);

		monitor.start();
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

		expect(mockCallProgressModel).toHaveBeenCalled();
		// addComment for initial comment at start(), then first tick updates
		expect(mockPMProvider.addComment).toHaveBeenCalledTimes(1);
		expect(mockPMProvider.updateComment).toHaveBeenCalledWith(
			'card1',
			'comment-id-1',
			'**Progress**: All good',
		);
	});

	it('updates existing comment on subsequent ticks (create-once-update pattern)', async () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockCallProgressModel.mockResolvedValue('**Progress**: All good');
		mockPMProvider.addComment.mockResolvedValue('comment-id-1');
		mockPMProvider.updateComment.mockResolvedValue(undefined);

		monitor.start();
		// First tick
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		// Second tick
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

		// addComment called once only (at start())
		expect(mockPMProvider.addComment).toHaveBeenCalledTimes(1);
		// Two ticks both update
		expect(mockPMProvider.updateComment).toHaveBeenCalledTimes(2);
		expect(mockPMProvider.updateComment).toHaveBeenCalledWith(
			'card1',
			'comment-id-1',
			'**Progress**: All good',
		);
	});

	it('falls back to new comment when updateComment fails (e.g. comment deleted)', async () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockCallProgressModel.mockResolvedValue('**Progress**: Still going');
		mockPMProvider.addComment.mockResolvedValue('comment-id-1');
		mockPMProvider.updateComment.mockRejectedValue(new Error('Comment not found'));

		monitor.start();
		// First tick — initial comment exists, update fails, falls back to new comment
		mockPMProvider.addComment.mockResolvedValue('comment-id-2');
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		// Second tick — update fails, falls back to new comment again
		mockPMProvider.addComment.mockResolvedValue('comment-id-3');
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

		// addComment called: once at start() + twice for fallback on each failed update
		expect(mockPMProvider.addComment).toHaveBeenCalledTimes(3);
		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			'Failed to update progress comment, creating new one',
			expect.any(Object),
		);
	});

	it('falls back to template when progress model fails', async () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockCallProgressModel.mockRejectedValue(new Error('Model error'));
		mockFormatStatus.mockReturnValue('Fallback progress');
		mockPMProvider.addComment.mockResolvedValue('comment-id-1');
		mockPMProvider.updateComment.mockResolvedValue(undefined);

		monitor.start();
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

		expect(mockFormatStatus).toHaveBeenCalled();
		// Initial comment was created at start(); tick updates it with fallback text
		expect(mockPMProvider.updateComment).toHaveBeenCalledWith(
			'card1',
			'comment-id-1',
			'Fallback progress',
		);
	});

	it('syncs checklist for implementation agents', async () => {
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockCallProgressModel.mockResolvedValue('Progress');
		mockPMProvider.addComment.mockResolvedValue('comment-id-1');
		mockSyncChecklist.mockResolvedValue();

		monitor.start();
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

		expect(mockSyncChecklist).toHaveBeenCalledWith('card1');
	});

	it('does not sync checklist for non-implementation agents', async () => {
		const monitor = new ProgressMonitor({
			agentType: 'planning',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockCallProgressModel.mockResolvedValue('Progress');
		mockPMProvider.addComment.mockResolvedValue('comment-id-1');

		monitor.start();
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

		expect(mockSyncChecklist).not.toHaveBeenCalled();
	});

	it('posts to GitHub when configured', async () => {
		const monitor = new ProgressMonitor({
			agentType: 'review',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			github: { owner: 'o', repo: 'r', headerMessage: 'Header' },
		});

		mockCallProgressModel.mockResolvedValue('Progress');
		mockGetSessionState.mockReturnValue({
			agentType: 'review',
			prCreated: false,
			prUrl: null,
			reviewSubmitted: false,
			reviewUrl: null,
			initialCommentId: 42,
		});
		mockFormatGitHub.mockReturnValue('GitHub body');
		mockGithub.updatePRComment.mockResolvedValue(undefined as never);

		monitor.start();
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

		expect(mockGithub.updatePRComment).toHaveBeenCalledWith('o', 'r', 42, expect.any(String));
	});

	it('skips GitHub post when no initialCommentId', async () => {
		const monitor = new ProgressMonitor({
			agentType: 'review',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			github: { owner: 'o', repo: 'r', headerMessage: 'Header' },
		});

		mockCallProgressModel.mockResolvedValue('Progress');
		mockGetSessionState.mockReturnValue({
			agentType: 'review',
			prCreated: false,
			prUrl: null,
			reviewSubmitted: false,
			reviewUrl: null,
			initialCommentId: null,
		});

		monitor.start();
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

		expect(mockGithub.updatePRComment).not.toHaveBeenCalled();
	});

	it('catches and logs Trello API error (does not throw)', async () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockCallProgressModel.mockResolvedValue('Progress');
		// Both initial comment and tick addComment fail
		mockPMProvider.addComment.mockRejectedValue(new Error('API error'));

		monitor.start();
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

		// At least one WARN with 'Failed' should be logged (initial comment failure + tick failure)
		expect(logWriter).toHaveBeenCalledWith(
			'WARN',
			expect.stringContaining('Failed'),
			expect.any(Object),
		);
	});

	it('prevents concurrent ticks', async () => {
		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 1,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			trello: { cardId: 'card1' },
		});

		// Make the progress model take a long time
		let resolveModel: (value: string) => void;
		mockCallProgressModel.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolveModel = resolve;
				}),
		);

		monitor.start();
		// Trigger first tick
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);

		// Trigger second tick while first is still running
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);

		// Only one call should have been made (second was skipped)
		expect(mockCallProgressModel).toHaveBeenCalledTimes(1);

		// Resolve the first call
		resolveModel?.('Done');
		await vi.advanceTimersByTimeAsync(0);

		monitor.stop();
	});
});

describe('createProgressMonitor', () => {
	it('returns null when status updates are disabled', () => {
		mockGetStatusConfig.mockReturnValue({
			enabled: false,
			intervalMinutes: 5,
			progressModel: 'test-model',
		});

		const monitor = createProgressMonitor({
			logWriter: vi.fn(),
			agentType: 'debug',
			taskDescription: 'Test',
			progressModel: 'test-model',
			intervalMinutes: 5,
			customModels: [],
		});

		expect(monitor).toBeNull();
	});

	it('returns a ProgressMonitor when enabled', () => {
		mockGetStatusConfig.mockReturnValue({
			enabled: true,
			intervalMinutes: 5,
			progressModel: 'test-model',
		});

		const monitor = createProgressMonitor({
			logWriter: vi.fn(),
			agentType: 'implementation',
			taskDescription: 'Test',
			progressModel: 'test-model',
			intervalMinutes: 5,
			customModels: [],
			trello: { cardId: 'card1' },
		});

		expect(monitor).toBeInstanceOf(ProgressMonitor);
	});
});

describe('ProgressMonitor — state file integration', () => {
	it('writes state file on initial comment when repoDir is provided', async () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'planning',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
			repoDir: '/tmp/test-repo',
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.addComment.mockResolvedValue('comment-id-initial');

		monitor.start();
		await vi.advanceTimersByTimeAsync(0);

		expect(mockWriteProgressCommentId).toHaveBeenCalledWith(
			'/tmp/test-repo',
			'card1',
			'comment-id-initial',
		);
		monitor.stop();
	});

	it('does not write state file when repoDir is not provided', async () => {
		const monitor = new ProgressMonitor({
			agentType: 'planning',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.addComment.mockResolvedValue('comment-id-initial');

		monitor.start();
		await vi.advanceTimersByTimeAsync(0);

		expect(mockWriteProgressCommentId).not.toHaveBeenCalled();
		monitor.stop();
	});

	it('clears state file on stop()', () => {
		const monitor = new ProgressMonitor({
			agentType: 'planning',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			repoDir: '/tmp/test-repo',
			trello: { cardId: 'card1' },
		});

		monitor.start();
		monitor.stop();

		expect(mockClearProgressCommentId).toHaveBeenCalledWith('/tmp/test-repo');
	});

	it('clears state file on stop() even when repoDir not provided', () => {
		const monitor = new ProgressMonitor({
			agentType: 'planning',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			trello: { cardId: 'card1' },
		});

		monitor.start();
		monitor.stop();

		expect(mockClearProgressCommentId).toHaveBeenCalledWith(undefined);
	});

	it('writes state file from first tick when postInitialComment() failed', async () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'planning',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
			repoDir: '/tmp/test-repo',
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockCallProgressModel.mockResolvedValue('Progress update');
		// Initial comment fails (transient API error)
		mockPMProvider.addComment
			.mockRejectedValueOnce(new Error('API error on initial'))
			// First tick succeeds
			.mockResolvedValueOnce('comment-id-from-tick');

		monitor.start();
		// Flush initial comment promise (it fails)
		await vi.advanceTimersByTimeAsync(0);

		// Reset mock to track only tick writes
		mockWriteProgressCommentId.mockClear();

		// First tick — enters else branch (progressCommentId is null)
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

		// State file should be written from the else branch in postProgressToPM
		expect(mockWriteProgressCommentId).toHaveBeenCalledWith(
			'/tmp/test-repo',
			'card1',
			'comment-id-from-tick',
		);
	});

	it('updates state file when new comment is created after update failure', async () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'planning',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
			repoDir: '/tmp/test-repo',
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockCallProgressModel.mockResolvedValue('Progress update');
		mockPMProvider.addComment
			.mockResolvedValueOnce('comment-id-initial')
			.mockResolvedValueOnce('comment-id-fallback');
		mockPMProvider.updateComment.mockRejectedValue(new Error('Comment not found'));

		monitor.start();
		await vi.advanceTimersByTimeAsync(0);
		// First tick — update fails, new comment created
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

		// writeProgressCommentId called for initial comment and for fallback comment
		expect(mockWriteProgressCommentId).toHaveBeenCalledTimes(2);
		expect(mockWriteProgressCommentId).toHaveBeenLastCalledWith(
			'/tmp/test-repo',
			'card1',
			'comment-id-fallback',
		);
	});
});
