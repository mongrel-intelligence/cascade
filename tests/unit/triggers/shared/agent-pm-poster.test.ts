import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockAddComment,
	mockUpdateComment,
	mockGetPMProviderOrNull,
	mockSafeOperation,
	mockLogger,
} = vi.hoisted(() => ({
	mockAddComment: vi.fn(),
	mockUpdateComment: vi.fn(),
	mockGetPMProviderOrNull: vi.fn(),
	mockSafeOperation: vi.fn(),
	mockLogger: {
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../../src/pm/index.js', () => ({
	getPMProviderOrNull: mockGetPMProviderOrNull,
}));

vi.mock('../../../../src/utils/safeOperation.js', () => ({
	safeOperation: mockSafeOperation,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import {
	PM_SUMMARY_AGENT_TYPES,
	formatAgentOutputForPM,
	formatReviewForPM,
	isOutputBasedAgent,
	postAgentOutputToPM,
	postReviewToPM,
} from '../../../../src/triggers/shared/agent-pm-poster.js';

describe('PM_SUMMARY_AGENT_TYPES and isOutputBasedAgent', () => {
	it('includes review and all output-based agent types', () => {
		expect(PM_SUMMARY_AGENT_TYPES).toContain('review');
		expect(PM_SUMMARY_AGENT_TYPES).toContain('respond-to-ci');
		expect(PM_SUMMARY_AGENT_TYPES).toContain('respond-to-review');
		expect(PM_SUMMARY_AGENT_TYPES).toContain('resolve-conflicts');
	});

	it('does not include non-summary agent types', () => {
		expect(PM_SUMMARY_AGENT_TYPES).not.toContain('implementation');
		expect(PM_SUMMARY_AGENT_TYPES).not.toContain('splitting');
	});

	it('isOutputBasedAgent returns true for output-based agents', () => {
		expect(isOutputBasedAgent('respond-to-ci')).toBe(true);
		expect(isOutputBasedAgent('respond-to-review')).toBe(true);
		expect(isOutputBasedAgent('resolve-conflicts')).toBe(true);
	});

	it('isOutputBasedAgent returns false for review and unknown types', () => {
		expect(isOutputBasedAgent('review')).toBe(false);
		expect(isOutputBasedAgent('implementation')).toBe(false);
	});
});

describe('formatReviewForPM', () => {
	it('formats an APPROVE review with correct emoji and label', () => {
		const result = formatReviewForPM('Looks good!', 'APPROVE', 'https://github.com/pr/1#review-1');

		expect(result).toContain('✅');
		expect(result).toContain('**Code Review: APPROVE**');
		expect(result).toContain('Looks good!');
		expect(result).toContain('[View review on GitHub](https://github.com/pr/1#review-1)');
	});

	it('formats a REQUEST_CHANGES review with correct emoji and label', () => {
		const result = formatReviewForPM(
			'Please fix this.',
			'REQUEST_CHANGES',
			'https://github.com/pr/2#review-2',
		);

		expect(result).toContain('🔄');
		expect(result).toContain('**Code Review: REQUEST CHANGES**');
		expect(result).toContain('Please fix this.');
		expect(result).toContain('[View review on GitHub](https://github.com/pr/2#review-2)');
	});

	it('formats a COMMENT review with correct emoji and label', () => {
		const result = formatReviewForPM(
			'Some thoughts.',
			'COMMENT',
			'https://github.com/pr/3#review-3',
		);

		expect(result).toContain('💬');
		expect(result).toContain('**Code Review: COMMENT**');
		expect(result).toContain('Some thoughts.');
		expect(result).toContain('[View review on GitHub](https://github.com/pr/3#review-3)');
	});

	it('uses a fallback emoji for unknown event types', () => {
		const result = formatReviewForPM(
			'A review.',
			'UNKNOWN_EVENT',
			'https://github.com/pr/4#review-4',
		);

		expect(result).toContain('📝');
		expect(result).toContain('**Code Review: UNKNOWN EVENT**');
	});

	it('truncates body that exceeds the max length', () => {
		const longBody = 'A'.repeat(16_000);
		const result = formatReviewForPM(longBody, 'COMMENT', 'https://github.com/pr/5#review-5');

		// Should be truncated and contain the notice
		expect(result).toContain('[Review body truncated — view full review on GitHub]');
		// Total length should be within a safe bound
		expect(result.length).toBeLessThan(16_000);
	});

	it('does not truncate short bodies', () => {
		const body = 'Short review body.';
		const result = formatReviewForPM(body, 'APPROVE', 'https://github.com/pr/6#review-6');

		expect(result).toContain(body);
		expect(result).not.toContain('[Review body truncated');
	});
});

describe('formatAgentOutputForPM', () => {
	it('formats respond-to-ci output with correct emoji and header', () => {
		const result = formatAgentOutputForPM(
			'respond-to-ci',
			'Fixed the CI failure by updating deps.',
		);

		expect(result).toContain('🔧');
		expect(result).toContain('**CI Fix Summary**');
		expect(result).toContain('Fixed the CI failure by updating deps.');
	});

	it('formats respond-to-review output with correct emoji and header', () => {
		const result = formatAgentOutputForPM('respond-to-review', 'Addressed all review comments.');

		expect(result).toContain('💬');
		expect(result).toContain('**Review Response Summary**');
		expect(result).toContain('Addressed all review comments.');
	});

	it('formats resolve-conflicts output with correct emoji and header', () => {
		const result = formatAgentOutputForPM(
			'resolve-conflicts',
			'Resolved merge conflicts in 3 files.',
		);

		expect(result).toContain('🔀');
		expect(result).toContain('**Conflict Resolution Summary**');
		expect(result).toContain('Resolved merge conflicts in 3 files.');
	});

	it('tail-extracts when output exceeds 2000 chars', () => {
		// Build output where the first part is clearly distinguishable from the tail
		const uniquePrefix = 'UNIQUE_START_MARKER\n';
		const filler = `${'B'.repeat(99)}\n`.repeat(30); // 3000 chars
		const suffix = 'Important final output line';
		const output = uniquePrefix + filler + suffix;

		const result = formatAgentOutputForPM('respond-to-ci', output);

		// Should contain the tail content
		expect(result).toContain(suffix);
		// Should contain truncation notice
		expect(result).toContain('[Output truncated — showing last portion]');
		// Should NOT contain the unique prefix (it was truncated away)
		expect(result).not.toContain('UNIQUE_START_MARKER');
	});

	it('does not truncate output at exactly 2000 chars', () => {
		const output = 'X'.repeat(2_000);
		const result = formatAgentOutputForPM('respond-to-ci', output);

		expect(result).toContain(output);
		expect(result).not.toContain('[Output truncated');
	});

	it('passes through short output without truncation', () => {
		const output = 'Short output.';
		const result = formatAgentOutputForPM('respond-to-ci', output);

		expect(result).toContain(output);
		expect(result).not.toContain('[Output truncated');
	});

	it('returns length-capped raw output for unknown agent type', () => {
		const output = 'Some output from an unknown agent.';
		const result = formatAgentOutputForPM('unknown-agent', output);

		// No header/emoji formatting — just the raw output
		expect(result).toBe(output);
	});

	it('caps output at MAX_BODY_LENGTH for unknown agent type', () => {
		const output = 'Z'.repeat(20_000);
		const result = formatAgentOutputForPM('unknown-agent', output);

		expect(result.length).toBe(15_000);
		expect(result).not.toContain('🔧'); // No formatting applied
	});
});

describe('postReviewToPM', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		// Default: safeOperation actually calls the fn
		mockSafeOperation.mockImplementation(async (fn: () => Promise<unknown>) => fn());
	});

	it('does nothing when reviewBody is null and logs reason', async () => {
		await postReviewToPM('card-123', {
			reviewBody: null,
			reviewEvent: 'APPROVE',
			reviewUrl: 'https://github.com/pr/1#review-1',
		});

		expect(mockGetPMProviderOrNull).not.toHaveBeenCalled();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'postReviewToPM skipped: missing reviewBody or reviewUrl',
			expect.objectContaining({ hasBody: false, hasUrl: true, workItemId: 'card-123' }),
		);
	});

	it('does nothing when reviewUrl is null and logs reason', async () => {
		await postReviewToPM('card-123', {
			reviewBody: 'Looks good!',
			reviewEvent: 'APPROVE',
			reviewUrl: null,
		});

		expect(mockGetPMProviderOrNull).not.toHaveBeenCalled();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'postReviewToPM skipped: missing reviewBody or reviewUrl',
			expect.objectContaining({ hasBody: true, hasUrl: false, workItemId: 'card-123' }),
		);
	});

	it('does nothing when PM provider is not available and logs reason', async () => {
		mockGetPMProviderOrNull.mockReturnValue(null);

		await postReviewToPM('card-123', {
			reviewBody: 'Looks good!',
			reviewEvent: 'APPROVE',
			reviewUrl: 'https://github.com/pr/1#review-1',
		});

		expect(mockAddComment).not.toHaveBeenCalled();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'postReviewToPM skipped: no PM provider available',
			expect.objectContaining({ workItemId: 'card-123' }),
		);
	});

	it('calls provider.addComment with formatted review when all data is present', async () => {
		mockGetPMProviderOrNull.mockReturnValue({ addComment: mockAddComment });
		mockAddComment.mockResolvedValue('comment-id-1');

		await postReviewToPM('card-123', {
			reviewBody: 'LGTM!',
			reviewEvent: 'APPROVE',
			reviewUrl: 'https://github.com/pr/1#review-1',
		});

		expect(mockAddComment).toHaveBeenCalledTimes(1);
		const [workItemId, text] = mockAddComment.mock.calls[0];
		expect(workItemId).toBe('card-123');
		expect(text).toContain('✅');
		expect(text).toContain('LGTM!');
		expect(text).toContain('https://github.com/pr/1#review-1');
	});

	it('defaults to COMMENT event when reviewEvent is null', async () => {
		mockGetPMProviderOrNull.mockReturnValue({ addComment: mockAddComment });
		mockAddComment.mockResolvedValue('comment-id-1');

		await postReviewToPM('card-123', {
			reviewBody: 'A review.',
			reviewEvent: null,
			reviewUrl: 'https://github.com/pr/1#review-1',
		});

		const [, text] = mockAddComment.mock.calls[0];
		expect(text).toContain('💬');
		expect(text).toContain('**Code Review: COMMENT**');
	});

	it('uses safeOperation so PM provider errors do not propagate', async () => {
		mockGetPMProviderOrNull.mockReturnValue({ addComment: mockAddComment });
		// Make safeOperation silently swallow the error (real behavior)
		mockSafeOperation.mockResolvedValue(undefined);

		// Should not throw even if underlying call would fail
		await expect(
			postReviewToPM('card-123', {
				reviewBody: 'Review!',
				reviewEvent: 'APPROVE',
				reviewUrl: 'https://github.com/pr/1#review-1',
			}),
		).resolves.toBeUndefined();

		expect(mockSafeOperation).toHaveBeenCalled();
	});

	it('updates existing comment when progressCommentId is provided and updateComment succeeds', async () => {
		mockGetPMProviderOrNull.mockReturnValue({
			addComment: mockAddComment,
			updateComment: mockUpdateComment,
		});
		mockUpdateComment.mockResolvedValue(undefined);

		await postReviewToPM(
			'card-123',
			{
				reviewBody: 'LGTM!',
				reviewEvent: 'APPROVE',
				reviewUrl: 'https://github.com/pr/1#review-1',
			},
			'comment-id-progress',
		);

		expect(mockUpdateComment).toHaveBeenCalledTimes(1);
		const [workItemId, commentId, text] = mockUpdateComment.mock.calls[0];
		expect(workItemId).toBe('card-123');
		expect(commentId).toBe('comment-id-progress');
		expect(text).toContain('✅');
		expect(text).toContain('LGTM!');
		expect(mockAddComment).not.toHaveBeenCalled();
		expect(mockLogger.info).toHaveBeenCalledWith(
			'Updated existing PM comment with review summary',
			expect.objectContaining({ workItemId: 'card-123', progressCommentId: 'comment-id-progress' }),
		);
	});

	it('falls back to addComment when progressCommentId is provided but updateComment throws', async () => {
		mockGetPMProviderOrNull.mockReturnValue({
			addComment: mockAddComment,
			updateComment: mockUpdateComment,
		});
		mockUpdateComment.mockRejectedValue(new Error('Comment not found'));
		mockAddComment.mockResolvedValue('comment-id-new');

		await postReviewToPM(
			'card-123',
			{
				reviewBody: 'LGTM!',
				reviewEvent: 'APPROVE',
				reviewUrl: 'https://github.com/pr/1#review-1',
			},
			'comment-id-deleted',
		);

		expect(mockUpdateComment).toHaveBeenCalledTimes(1);
		expect(mockAddComment).toHaveBeenCalledTimes(1);
		const [workItemId, text] = mockAddComment.mock.calls[0];
		expect(workItemId).toBe('card-123');
		expect(text).toContain('✅');
		expect(text).toContain('LGTM!');
		expect(mockLogger.info).toHaveBeenCalledWith(
			'Added new PM comment with review summary (update failed)',
			expect.objectContaining({ workItemId: 'card-123', progressCommentId: 'comment-id-deleted' }),
		);
	});

	it('uses addComment (not updateComment) when progressCommentId is undefined', async () => {
		mockGetPMProviderOrNull.mockReturnValue({
			addComment: mockAddComment,
			updateComment: mockUpdateComment,
		});
		mockAddComment.mockResolvedValue('comment-id-1');

		await postReviewToPM('card-123', {
			reviewBody: 'LGTM!',
			reviewEvent: 'APPROVE',
			reviewUrl: 'https://github.com/pr/1#review-1',
		});

		expect(mockAddComment).toHaveBeenCalledTimes(1);
		expect(mockUpdateComment).not.toHaveBeenCalled();
		expect(mockLogger.info).toHaveBeenCalledWith(
			'Added new PM comment with review summary',
			expect.objectContaining({ workItemId: 'card-123' }),
		);
	});
});

describe('postAgentOutputToPM', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockSafeOperation.mockImplementation(async (fn: () => Promise<unknown>) => fn());
	});

	it('skips when output is empty', async () => {
		await postAgentOutputToPM('card-123', 'respond-to-ci', '');

		expect(mockGetPMProviderOrNull).not.toHaveBeenCalled();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'postAgentOutputToPM skipped: empty output',
			expect.objectContaining({ workItemId: 'card-123', agentType: 'respond-to-ci' }),
		);
	});

	it('skips when output is whitespace-only', async () => {
		await postAgentOutputToPM('card-123', 'respond-to-review', '   \n\t  ');

		expect(mockGetPMProviderOrNull).not.toHaveBeenCalled();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'postAgentOutputToPM skipped: empty output',
			expect.objectContaining({ workItemId: 'card-123', agentType: 'respond-to-review' }),
		);
	});

	it('updates existing comment when progressCommentId is provided', async () => {
		mockGetPMProviderOrNull.mockReturnValue({
			addComment: mockAddComment,
			updateComment: mockUpdateComment,
		});
		mockUpdateComment.mockResolvedValue(undefined);

		await postAgentOutputToPM('card-123', 'respond-to-ci', 'Fixed CI by updating deps.', 'prog-1');

		expect(mockUpdateComment).toHaveBeenCalledTimes(1);
		const [workItemId, commentId, text] = mockUpdateComment.mock.calls[0];
		expect(workItemId).toBe('card-123');
		expect(commentId).toBe('prog-1');
		expect(text).toContain('🔧');
		expect(text).toContain('**CI Fix Summary**');
		expect(text).toContain('Fixed CI by updating deps.');
		expect(mockAddComment).not.toHaveBeenCalled();
	});

	it('creates new comment when progressCommentId is not provided', async () => {
		mockGetPMProviderOrNull.mockReturnValue({
			addComment: mockAddComment,
			updateComment: mockUpdateComment,
		});
		mockAddComment.mockResolvedValue('new-comment-id');

		await postAgentOutputToPM('card-123', 'resolve-conflicts', 'Resolved 3 conflicts.');

		expect(mockAddComment).toHaveBeenCalledTimes(1);
		const [workItemId, text] = mockAddComment.mock.calls[0];
		expect(workItemId).toBe('card-123');
		expect(text).toContain('🔀');
		expect(text).toContain('**Conflict Resolution Summary**');
		expect(text).toContain('Resolved 3 conflicts.');
		expect(mockUpdateComment).not.toHaveBeenCalled();
	});

	it('falls back to addComment when update fails', async () => {
		mockGetPMProviderOrNull.mockReturnValue({
			addComment: mockAddComment,
			updateComment: mockUpdateComment,
		});
		mockUpdateComment.mockRejectedValue(new Error('Not found'));
		mockAddComment.mockResolvedValue('new-id');

		await postAgentOutputToPM('card-123', 'respond-to-review', 'Addressed comments.', 'prog-2');

		expect(mockUpdateComment).toHaveBeenCalledTimes(1);
		expect(mockAddComment).toHaveBeenCalledTimes(1);
	});

	it('logs with function name prefix when PM provider is unavailable', async () => {
		mockGetPMProviderOrNull.mockReturnValue(null);

		await postAgentOutputToPM('card-123', 'respond-to-ci', 'Some output.');

		expect(mockLogger.warn).toHaveBeenCalledWith(
			'postAgentOutputToPM skipped: no PM provider available',
			expect.objectContaining({ workItemId: 'card-123' }),
		);
	});
});
