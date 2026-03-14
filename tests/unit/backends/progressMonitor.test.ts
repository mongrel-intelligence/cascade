import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockAccumulatorConstructor,
	mockOnIteration,
	mockOnToolCall,
	mockOnText,
	mockOnTaskCompleted,
	mockGetSnapshot,
	mockSchedulerConstructor,
	mockSchedulerStart,
	mockSchedulerStop,
	mockPMPosterConstructor,
	mockPMPosterPostInitial,
	mockPMPosterUpdate,
	mockPMPosterGetCommentId,
	mockPMPosterSetCommentId,
	mockGitHubPosterConstructor,
	mockGitHubPosterUpdate,
	mockCallProgressModel,
	mockFormatStatusMessage,
	mockCaptureException,
	mockWriteProgressCommentId,
	mockClearProgressCommentId,
	mockSyncCompletedTodosToChecklist,
} = vi.hoisted(() => {
	const mockOnIteration = vi.fn();
	const mockOnToolCall = vi.fn();
	const mockOnText = vi.fn();
	const mockOnTaskCompleted = vi.fn();
	const mockGetSnapshot = vi.fn().mockReturnValue({ elapsedMinutes: 5 });

	const mockSchedulerStart = vi.fn();
	const mockSchedulerStop = vi.fn();

	const mockPMPosterPostInitial = vi.fn().mockResolvedValue(undefined);
	const mockPMPosterUpdate = vi.fn().mockResolvedValue(undefined);
	const mockPMPosterGetCommentId = vi.fn().mockReturnValue('comment-123');
	const mockPMPosterSetCommentId = vi.fn();

	const mockGitHubPosterUpdate = vi.fn().mockResolvedValue(undefined);

	return {
		mockAccumulatorConstructor: vi.fn(),
		mockOnIteration,
		mockOnToolCall,
		mockOnText,
		mockOnTaskCompleted,
		mockGetSnapshot,
		mockSchedulerConstructor: vi.fn(),
		mockSchedulerStart,
		mockSchedulerStop,
		mockPMPosterConstructor: vi.fn(),
		mockPMPosterPostInitial,
		mockPMPosterUpdate,
		mockPMPosterGetCommentId,
		mockPMPosterSetCommentId,
		mockGitHubPosterConstructor: vi.fn(),
		mockGitHubPosterUpdate,
		mockCallProgressModel: vi.fn().mockResolvedValue('Progress summary'),
		mockFormatStatusMessage: vi.fn().mockReturnValue('Template fallback message'),
		mockCaptureException: vi.fn(),
		mockWriteProgressCommentId: vi.fn(),
		mockClearProgressCommentId: vi.fn(),
		mockSyncCompletedTodosToChecklist: vi.fn().mockResolvedValue(undefined),
	};
});

vi.mock('../../../src/backends/progressState/accumulator.js', () => ({
	ProgressAccumulator: mockAccumulatorConstructor.mockImplementation(() => ({
		onIteration: mockOnIteration,
		onToolCall: mockOnToolCall,
		onText: mockOnText,
		onTaskCompleted: mockOnTaskCompleted,
		getSnapshot: mockGetSnapshot,
	})),
}));

vi.mock('../../../src/backends/progressState/scheduler.js', () => ({
	DEFAULT_SCHEDULE_MINUTES: [1, 3, 5],
	ProgressScheduler: mockSchedulerConstructor.mockImplementation(() => ({
		start: mockSchedulerStart,
		stop: mockSchedulerStop,
	})),
}));

vi.mock('../../../src/backends/progressState/pmPoster.js', () => ({
	PMProgressPoster: mockPMPosterConstructor.mockImplementation(() => ({
		postInitial: mockPMPosterPostInitial,
		update: mockPMPosterUpdate,
		getCommentId: mockPMPosterGetCommentId,
		setCommentId: mockPMPosterSetCommentId,
	})),
}));

vi.mock('../../../src/backends/progressState/githubPoster.js', () => ({
	GitHubProgressPoster: mockGitHubPosterConstructor.mockImplementation(() => ({
		update: mockGitHubPosterUpdate,
	})),
}));

vi.mock('../../../src/backends/progressModel.js', () => ({
	callProgressModel: mockCallProgressModel,
}));

vi.mock('../../../src/config/statusUpdateConfig.js', () => ({
	formatStatusMessage: mockFormatStatusMessage,
}));

vi.mock('../../../src/sentry.js', () => ({
	captureException: mockCaptureException,
}));

vi.mock('../../../src/backends/progressState.js', () => ({
	writeProgressCommentId: mockWriteProgressCommentId,
	clearProgressCommentId: mockClearProgressCommentId,
}));

vi.mock('../../../src/agents/utils/checklistSync.js', () => ({
	syncCompletedTodosToChecklist: mockSyncCompletedTodosToChecklist,
}));

import {
	ProgressMonitor,
	type ProgressMonitorConfig,
} from '../../../src/backends/progressMonitor.js';

function makeConfig(overrides: Partial<ProgressMonitorConfig> = {}): ProgressMonitorConfig {
	return {
		agentType: 'implementation',
		taskDescription: 'Implement the feature',
		intervalMinutes: 5,
		progressModel: 'claude-3-haiku',
		customModels: [],
		logWriter: vi.fn(),
		...overrides,
	};
}

describe('ProgressMonitor - constructor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('creates PMProgressPoster when trello config is provided', () => {
		new ProgressMonitor(makeConfig({ trello: { workItemId: 'card-1' } }));

		expect(mockPMPosterConstructor).toHaveBeenCalledWith(
			expect.objectContaining({ workItemId: 'card-1' }),
		);
	});

	it('does not create PMProgressPoster without trello config', () => {
		new ProgressMonitor(makeConfig());

		expect(mockPMPosterConstructor).not.toHaveBeenCalled();
	});

	it('creates GitHubProgressPoster when github config is provided', () => {
		new ProgressMonitor(
			makeConfig({
				github: { owner: 'owner', repo: 'repo' },
			}),
		);

		expect(mockGitHubPosterConstructor).toHaveBeenCalledWith(
			expect.objectContaining({ owner: 'owner', repo: 'repo' }),
		);
	});

	it('does not create GitHubProgressPoster without github config', () => {
		new ProgressMonitor(makeConfig());

		expect(mockGitHubPosterConstructor).not.toHaveBeenCalled();
	});

	it('uses DEFAULT_SCHEDULE_MINUTES when scheduleMinutes not provided', () => {
		new ProgressMonitor(makeConfig());

		expect(mockSchedulerConstructor).toHaveBeenCalledWith([1, 3, 5], 5);
	});

	it('uses custom scheduleMinutes when provided', () => {
		new ProgressMonitor(makeConfig({ scheduleMinutes: [2, 4] }));

		expect(mockSchedulerConstructor).toHaveBeenCalledWith([2, 4], 5);
	});
});

describe('ProgressMonitor - start()', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('starts the scheduler', () => {
		const monitor = new ProgressMonitor(makeConfig());
		monitor.start();

		expect(mockSchedulerStart).toHaveBeenCalledWith(expect.any(Function));
	});

	it('does not start twice on double-start', () => {
		const monitor = new ProgressMonitor(makeConfig());
		monitor.start();
		monitor.start();

		expect(mockSchedulerStart).toHaveBeenCalledTimes(1);
	});

	it('uses pre-seeded comment ID when provided, skips postInitial', () => {
		const config = makeConfig({
			preSeededCommentId: 'pre-seed-123',
			trello: { workItemId: 'card-1' },
		});
		const monitor = new ProgressMonitor(config);
		monitor.start();

		expect(mockPMPosterSetCommentId).toHaveBeenCalledWith('pre-seed-123');
		expect(mockPMPosterPostInitial).not.toHaveBeenCalled();
	});

	it('writes progress comment ID to env var when preSeededCommentId + trello', () => {
		const config = makeConfig({
			preSeededCommentId: 'seed-id',
			trello: { workItemId: 'card-1' },
		});
		const monitor = new ProgressMonitor(config);
		monitor.start();

		expect(mockWriteProgressCommentId).toHaveBeenCalledWith('card-1', 'seed-id');
	});

	it('posts initial comment when no preSeededCommentId and trello is configured', () => {
		const config = makeConfig({ trello: { workItemId: 'card-1' } });
		const monitor = new ProgressMonitor(config);
		monitor.start();

		expect(mockPMPosterPostInitial).toHaveBeenCalled();
	});

	it('does not call postInitial when no trello config', () => {
		const monitor = new ProgressMonitor(makeConfig());
		monitor.start();

		expect(mockPMPosterPostInitial).not.toHaveBeenCalled();
	});
});

describe('ProgressMonitor - stop()', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('stops the scheduler', () => {
		const monitor = new ProgressMonitor(makeConfig());
		monitor.stop();

		expect(mockSchedulerStop).toHaveBeenCalled();
	});

	it('clears the progress comment ID state', () => {
		const monitor = new ProgressMonitor(makeConfig());
		monitor.stop();

		expect(mockClearProgressCommentId).toHaveBeenCalledWith();
	});

	it('does not throw when clearProgressCommentId fails', () => {
		mockClearProgressCommentId.mockImplementationOnce(() => {
			throw new Error('File not found');
		});
		const monitor = new ProgressMonitor(makeConfig());

		expect(() => monitor.stop()).not.toThrow();
	});
});

describe('ProgressMonitor - tick (via scheduler callback)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCallProgressModel.mockResolvedValue('AI-generated summary');
	});

	async function runTick(config: ProgressMonitorConfig): Promise<void> {
		const monitor = new ProgressMonitor(config);
		monitor.start();

		// Get the callback passed to scheduler.start
		const tickCallback = mockSchedulerStart.mock.calls[0]?.[0] as (() => Promise<void>) | undefined;
		if (!tickCallback) throw new Error('No tick callback');

		await tickCallback();
	}

	it('calls callProgressModel with agentType and taskDescription', async () => {
		await runTick(makeConfig({ trello: { workItemId: 'card-1' } }));

		expect(mockCallProgressModel).toHaveBeenCalledWith(
			'claude-3-haiku',
			expect.objectContaining({}),
			[],
		);
	});

	it('posts summary to PM when trello configured', async () => {
		await runTick(makeConfig({ trello: { workItemId: 'card-1' } }));

		expect(mockPMPosterUpdate).toHaveBeenCalledWith('AI-generated summary');
	});

	it('posts summary to GitHub when github configured', async () => {
		await runTick(makeConfig({ github: { owner: 'o', repo: 'r' } }));

		expect(mockGitHubPosterUpdate).toHaveBeenCalledWith('AI-generated summary');
	});

	it('falls back to formatStatusMessage when callProgressModel fails', async () => {
		mockCallProgressModel.mockRejectedValueOnce(new Error('LLM unavailable'));

		await runTick(makeConfig({ trello: { workItemId: 'card-1' } }));

		expect(mockFormatStatusMessage).toHaveBeenCalledWith('implementation');
		expect(mockPMPosterUpdate).toHaveBeenCalledWith('Template fallback message');
	});

	it('reports exception to sentry on model failure', async () => {
		mockCallProgressModel.mockRejectedValueOnce(new Error('LLM error'));

		await runTick(makeConfig());

		expect(mockCaptureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ tags: expect.objectContaining({ source: 'progress_model' }) }),
		);
	});

	it('skips second concurrent tick when isGenerating is true', async () => {
		const monitor = new ProgressMonitor(makeConfig({ trello: { workItemId: 'card-1' } }));

		// Simulate long-running model call
		let resolveModel: (val: string) => void = () => {};
		mockCallProgressModel.mockImplementationOnce(
			() =>
				new Promise<string>((r) => {
					resolveModel = r;
				}),
		);

		monitor.start();
		const tickCallback = mockSchedulerStart.mock.calls[0]?.[0] as () => Promise<void>;

		// Start first tick (will block on model)
		const tick1 = tickCallback();

		// Start second tick immediately
		const tick2 = tickCallback();

		// Second tick should complete quickly (skipped)
		await tick2;
		expect(mockCallProgressModel).toHaveBeenCalledTimes(1);

		// Resolve first tick
		resolveModel('summary');
		await tick1;
		expect(mockPMPosterUpdate).toHaveBeenCalledTimes(1);
	});

	it('syncs todos to checklist for implementation agent with trello', async () => {
		await runTick(makeConfig({ trello: { workItemId: 'card-1' } }));

		expect(mockSyncCompletedTodosToChecklist).toHaveBeenCalledWith('card-1');
	});

	it('does not sync todos for non-implementation agents', async () => {
		await runTick(makeConfig({ agentType: 'review', trello: { workItemId: 'card-1' } }));

		expect(mockSyncCompletedTodosToChecklist).not.toHaveBeenCalled();
	});
});

describe('ProgressMonitor - ProgressReporter interface', () => {
	it('delegates onIteration to accumulator', async () => {
		const monitor = new ProgressMonitor(makeConfig());
		await monitor.onIteration(3, 20);
		expect(mockOnIteration).toHaveBeenCalledWith(3, 20);
	});

	it('delegates onToolCall to accumulator', () => {
		const monitor = new ProgressMonitor(makeConfig());
		monitor.onToolCall('ReadFile', { path: '/src/file.ts' });
		expect(mockOnToolCall).toHaveBeenCalledWith('ReadFile', { path: '/src/file.ts' });
	});

	it('delegates onText to accumulator', () => {
		const monitor = new ProgressMonitor(makeConfig());
		monitor.onText('Some text');
		expect(mockOnText).toHaveBeenCalledWith('Some text');
	});

	it('delegates onTaskCompleted to accumulator', () => {
		const monitor = new ProgressMonitor(makeConfig());
		monitor.onTaskCompleted('task-1', 'Add tests', 'Tests were added');
		expect(mockOnTaskCompleted).toHaveBeenCalledWith('task-1', 'Add tests', 'Tests were added');
	});

	it('getProgressCommentId returns pmPoster comment id when trello configured', () => {
		mockPMPosterGetCommentId.mockReturnValue('comment-abc');
		const monitor = new ProgressMonitor(makeConfig({ trello: { workItemId: 'card-1' } }));
		expect(monitor.getProgressCommentId()).toBe('comment-abc');
	});

	it('getProgressCommentId returns null when no trello configured', () => {
		const monitor = new ProgressMonitor(makeConfig());
		expect(monitor.getProgressCommentId()).toBeNull();
	});
});
