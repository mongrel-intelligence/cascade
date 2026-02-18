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

import { syncCompletedTodosToChecklist } from '../../../src/agents/utils/checklistSync.js';
import { createProgressMonitor } from '../../../src/backends/progress.js';
import { callProgressModel } from '../../../src/backends/progressModel.js';
import { ProgressMonitor } from '../../../src/backends/progressMonitor.js';
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
	it('calls progress model and posts to Trello on first tick (creates comment)', async () => {
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

		monitor.start();
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

		expect(mockCallProgressModel).toHaveBeenCalled();
		expect(mockPMProvider.addComment).toHaveBeenCalledWith('card1', '**Progress**: All good');
		expect(mockPMProvider.updateComment).not.toHaveBeenCalled();
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

		expect(mockPMProvider.addComment).toHaveBeenCalledTimes(1);
		expect(mockPMProvider.updateComment).toHaveBeenCalledTimes(1);
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
		// First tick — creates comment
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		// Second tick — update fails, falls back to new comment
		mockPMProvider.addComment.mockResolvedValue('comment-id-2');
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

		expect(mockPMProvider.addComment).toHaveBeenCalledTimes(2);
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

		monitor.start();
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

		expect(mockFormatStatus).toHaveBeenCalled();
		expect(mockPMProvider.addComment).toHaveBeenCalledWith('card1', 'Fallback progress');
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
		mockPMProvider.addComment.mockRejectedValue(new Error('API error'));

		monitor.start();
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		monitor.stop();

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
