import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAddComment, mockGetPMProviderOrNull, mockSafeOperation, mockLogger } = vi.hoisted(
	() => ({
		mockAddComment: vi.fn(),
		mockGetPMProviderOrNull: vi.fn(),
		mockSafeOperation: vi.fn(),
		mockLogger: {
			info: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
		},
	}),
);

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
	formatReviewForPM,
	postReviewToPM,
} from '../../../../src/triggers/shared/review-pm-poster.js';

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

describe('postReviewToPM', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		// Default: safeOperation actually calls the fn
		mockSafeOperation.mockImplementation(async (fn: () => Promise<unknown>) => fn());
	});

	it('does nothing when reviewBody is null', async () => {
		await postReviewToPM('card-123', {
			reviewBody: null,
			reviewEvent: 'APPROVE',
			reviewUrl: 'https://github.com/pr/1#review-1',
		});

		expect(mockGetPMProviderOrNull).not.toHaveBeenCalled();
	});

	it('does nothing when reviewUrl is null', async () => {
		await postReviewToPM('card-123', {
			reviewBody: 'Looks good!',
			reviewEvent: 'APPROVE',
			reviewUrl: null,
		});

		expect(mockGetPMProviderOrNull).not.toHaveBeenCalled();
	});

	it('does nothing when PM provider is not available', async () => {
		mockGetPMProviderOrNull.mockReturnValue(null);

		await postReviewToPM('card-123', {
			reviewBody: 'Looks good!',
			reviewEvent: 'APPROVE',
			reviewUrl: 'https://github.com/pr/1#review-1',
		});

		expect(mockAddComment).not.toHaveBeenCalled();
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
});
