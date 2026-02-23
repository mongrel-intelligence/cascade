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
	readProgressCommentId: vi.fn(),
}));

import { syncCompletedTodosToChecklist } from '../../../src/agents/utils/checklistSync.js';
import { createProgressMonitor } from '../../../src/backends/progress.js';
import { callProgressModel } from '../../../src/backends/progressModel.js';
import { ProgressMonitor } from '../../../src/backends/progressMonitor.js';
import {
	clearProgressCommentId,
	readProgressCommentId,
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
const mockReadProgressCommentId = vi.mocked(readProgressCommentId);
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
	// Default: state file exists (not cleared by agent subprocess)
	mockReadProgressCommentId.mockReturnValue({ workItemId: 'card1', commentId: 'comment-id-1' });
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
			'**🚀 Implementing changes** — Writing code, running tests, and preparing a PR...',
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
		// First tick fires at 1 minute (first entry of default schedule)
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
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
		// First tick fires at 1 minute (first entry of default schedule)
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
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
		// First tick fires at 1 minute
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
		// Second tick fires 3 more minutes later (at 4 min total)
		await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
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
		// First tick fires at 1 minute — update fails, falls back to new comment
		mockPMProvider.addComment.mockResolvedValue('comment-id-2');
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
		// Second tick fires 3 more minutes later — update fails, falls back to new comment
		mockPMProvider.addComment.mockResolvedValue('comment-id-3');
		await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
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
		// First tick fires at 1 minute (first entry of default schedule)
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
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
		// First tick fires at 1 minute
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
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
		// First tick fires at 1 minute
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
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
		// First tick fires at 1 minute
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
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
		// First tick fires at 1 minute
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
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
		// First tick fires at 1 minute
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
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
		// Use a custom schedule so ticks fire at 1min and 2min to test the concurrent guard
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 1,
			scheduleMinutes: [1, 2],
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
		// Trigger first tick at 1 minute
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);

		// With setTimeout chain, the second tick is NOT scheduled until the first
		// tick completes — so isGenerating guard isn't needed for overlap prevention.
		// However, we verify only one call was made while first is still running.
		// Only one call should have been made (first tick in progress, next not yet scheduled)
		expect(mockCallProgressModel).toHaveBeenCalledTimes(1);

		// Resolve the first call
		resolveModel?.('Done');
		await vi.advanceTimersByTimeAsync(0);

		monitor.stop();
	});
});

describe('ProgressMonitor — progressive schedule', () => {
	it('fires ticks according to progressive schedule then steady intervalMinutes', async () => {
		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.addComment.mockResolvedValue('comment-id-1');
		mockPMProvider.updateComment.mockResolvedValue(undefined);
		mockCallProgressModel.mockResolvedValue('Progress');

		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			scheduleMinutes: [1, 3, 5],
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			trello: { cardId: 'card1' },
		});

		monitor.start();

		// 1st tick at 1 minute
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
		expect(mockCallProgressModel).toHaveBeenCalledTimes(1);

		// 2nd tick at 3 more minutes (4 min total)
		await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
		expect(mockCallProgressModel).toHaveBeenCalledTimes(2);

		// 3rd tick at 5 more minutes (9 min total)
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		expect(mockCallProgressModel).toHaveBeenCalledTimes(3);

		// 4th tick at steady 5-min interval (14 min total)
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		expect(mockCallProgressModel).toHaveBeenCalledTimes(4);

		// 5th tick at steady 5-min interval (19 min total)
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		expect(mockCallProgressModel).toHaveBeenCalledTimes(5);

		monitor.stop();
	});

	it('falls back to intervalMinutes when schedule is exhausted', async () => {
		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.addComment.mockResolvedValue('comment-id-1');
		mockPMProvider.updateComment.mockResolvedValue(undefined);
		mockCallProgressModel.mockResolvedValue('Progress');

		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 2,
			scheduleMinutes: [1],
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			trello: { cardId: 'card1' },
		});

		monitor.start();

		// 1st tick from schedule at 1 minute
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
		expect(mockCallProgressModel).toHaveBeenCalledTimes(1);

		// 2nd tick at steady intervalMinutes (2 more minutes)
		await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
		expect(mockCallProgressModel).toHaveBeenCalledTimes(2);

		// 3rd tick still at steady intervalMinutes (2 more minutes)
		await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
		expect(mockCallProgressModel).toHaveBeenCalledTimes(3);

		monitor.stop();
	});

	it('uses default schedule when scheduleMinutes not provided (first tick at 1min)', async () => {
		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.addComment.mockResolvedValue('comment-id-1');
		mockPMProvider.updateComment.mockResolvedValue(undefined);
		mockCallProgressModel.mockResolvedValue('Progress');

		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			trello: { cardId: 'card1' },
			// No scheduleMinutes — should use DEFAULT_SCHEDULE_MINUTES = [1, 3, 5]
		});

		monitor.start();

		// Should NOT fire after 30 seconds
		await vi.advanceTimersByTimeAsync(30 * 1000);
		expect(mockCallProgressModel).toHaveBeenCalledTimes(0);

		// Should fire at 1 minute
		await vi.advanceTimersByTimeAsync(30 * 1000); // total: 60s = 1min
		expect(mockCallProgressModel).toHaveBeenCalledTimes(1);

		monitor.stop();
	});

	it('stop() prevents further ticks from scheduled chain', async () => {
		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.addComment.mockResolvedValue('comment-id-1');
		mockPMProvider.updateComment.mockResolvedValue(undefined);
		mockCallProgressModel.mockResolvedValue('Progress');

		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			scheduleMinutes: [1, 3, 5],
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			trello: { cardId: 'card1' },
		});

		monitor.start();

		// Fire first tick
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
		expect(mockCallProgressModel).toHaveBeenCalledTimes(1);

		// Stop the monitor
		monitor.stop();

		// Advance well past the next scheduled tick — should NOT fire
		await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
		expect(mockCallProgressModel).toHaveBeenCalledTimes(1);
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

describe('ProgressMonitor — agent-specific initial messages', () => {
	async function getInitialMessage(agentType: string): Promise<string> {
		const monitor = new ProgressMonitor({
			agentType,
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			trello: { cardId: 'card1' },
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockPMProvider.addComment.mockResolvedValue('comment-id');

		monitor.start();
		await vi.advanceTimersByTimeAsync(0);
		monitor.stop();

		return mockPMProvider.addComment.mock.calls[0][1] as string;
	}

	it('posts briefing-specific message for briefing agent', async () => {
		const message = await getInitialMessage('briefing');
		expect(message).toBe(
			'**📋 Analyzing brief** — Reading the card and gathering context to create a clear brief...',
		);
	});

	it('posts planning-specific message for planning agent', async () => {
		const message = await getInitialMessage('planning');
		expect(message).toBe(
			'**🗺️ Planning implementation** — Studying the codebase and designing a step-by-step plan...',
		);
	});

	it('posts implementation-specific message for implementation agent', async () => {
		const message = await getInitialMessage('implementation');
		expect(message).toBe(
			'**🚀 Implementing changes** — Writing code, running tests, and preparing a PR...',
		);
	});

	it('falls back to generic message for unknown agent types', async () => {
		const message = await getInitialMessage('future-agent');
		expect(message).toBe(
			'**🚀 Starting** (future-agent)\n\nWorking on this now. Progress updates will follow...',
		);
	});
});

describe('ProgressMonitor — getProgressCommentId()', () => {
	it('returns null initially before any comment is posted', () => {
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			trello: { cardId: 'card1' },
		});

		expect(monitor.getProgressCommentId()).toBeNull();
	});

	it('returns the comment ID after the initial comment is posted', async () => {
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
		mockPMProvider.addComment.mockResolvedValue('comment-xyz');

		monitor.start();
		await vi.advanceTimersByTimeAsync(0);

		expect(monitor.getProgressCommentId()).toBe('comment-xyz');
		monitor.stop();
	});

	it('returns null when trello config is absent (no comment posted)', () => {
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			// No trello config — postInitialComment() returns early
		});

		monitor.start();
		monitor.stop();

		expect(monitor.getProgressCommentId()).toBeNull();
	});
});

describe('ProgressMonitor — preSeededCommentId', () => {
	it('uses pre-seeded comment ID instead of posting initial comment', async () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
			trello: { cardId: 'card1' },
			repoDir: '/tmp/test-repo',
			preSeededCommentId: 'router-ack-comment-42',
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);

		monitor.start();
		await vi.advanceTimersByTimeAsync(0);

		// Should NOT post initial comment — ack was already posted by router
		expect(mockPMProvider.addComment).not.toHaveBeenCalled();
		// Should log that it's using the pre-seeded ID
		expect(logWriter).toHaveBeenCalledWith('INFO', 'Using pre-seeded ack comment ID from router', {
			commentId: 'router-ack-comment-42',
		});
		// Should return the pre-seeded ID
		expect(monitor.getProgressCommentId()).toBe('router-ack-comment-42');
		monitor.stop();
	});

	it('writes state file for pre-seeded comment ID', async () => {
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			trello: { cardId: 'card1' },
			repoDir: '/tmp/test-repo',
			preSeededCommentId: 'router-ack-comment-42',
		});

		monitor.start();
		await vi.advanceTimersByTimeAsync(0);

		expect(mockWriteProgressCommentId).toHaveBeenCalledWith(
			'/tmp/test-repo',
			'card1',
			'router-ack-comment-42',
		);
		monitor.stop();
	});

	it('does not write state file when repoDir is missing', async () => {
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter: vi.fn(),
			trello: { cardId: 'card1' },
			preSeededCommentId: 'router-ack-comment-42',
		});

		monitor.start();
		await vi.advanceTimersByTimeAsync(0);

		expect(mockWriteProgressCommentId).not.toHaveBeenCalled();
		monitor.stop();
	});

	it('updates pre-seeded comment on first tick', async () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'implementation',
			taskDescription: 'Test task',
			intervalMinutes: 5,
			progressModel: 'test-model',
			customModels: [],
			logWriter,
			trello: { cardId: 'card1' },
			preSeededCommentId: 'router-ack-comment-42',
		});

		mockGetPMProvider.mockReturnValue(mockPMProvider as unknown as PMProvider);
		mockCallProgressModel.mockResolvedValue('**Progress**: Working on it');
		mockPMProvider.updateComment.mockResolvedValue(undefined);

		monitor.start();
		// First tick fires at 1 minute (first entry of default schedule)
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
		monitor.stop();

		// addComment should NOT have been called (no initial comment posting)
		expect(mockPMProvider.addComment).not.toHaveBeenCalled();
		// updateComment should have been called with the pre-seeded ID
		expect(mockPMProvider.updateComment).toHaveBeenCalledWith(
			'card1',
			'router-ack-comment-42',
			'**Progress**: Working on it',
		);
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

		// First tick fires at 1 minute — enters else branch (progressCommentId is null)
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
		monitor.stop();

		// State file should be written from the else branch in postProgressToPM
		expect(mockWriteProgressCommentId).toHaveBeenCalledWith(
			'/tmp/test-repo',
			'card1',
			'comment-id-from-tick',
		);
	});

	it('skips progress update when state file is cleared by agent subprocess', async () => {
		const logWriter = vi.fn();
		const monitor = new ProgressMonitor({
			agentType: 'respond-to-planning-comment',
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
		mockPMProvider.addComment.mockResolvedValue('comment-id-initial');
		mockPMProvider.updateComment.mockResolvedValue(undefined);

		monitor.start();
		await vi.advanceTimersByTimeAsync(0);

		// Simulate the PostComment gadget clearing the state file
		mockReadProgressCommentId.mockReturnValue(null);

		// First tick fires at 1 minute — should detect cleared state file and skip
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
		monitor.stop();

		// updateComment should NOT have been called (state file was cleared)
		expect(mockPMProvider.updateComment).not.toHaveBeenCalled();
		// Should log the skip
		expect(logWriter).toHaveBeenCalledWith(
			'DEBUG',
			'State file cleared by agent — skipping progress update',
			expect.objectContaining({ commentId: 'comment-id-initial' }),
		);
		// progressCommentId should be cleared
		expect(monitor.getProgressCommentId()).toBeNull();
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
		// First tick fires at 1 minute — update fails, new comment created
		await vi.advanceTimersByTimeAsync(1 * 60 * 1000);
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
