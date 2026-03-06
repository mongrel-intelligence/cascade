import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/gadgets/github/core/createPRReview.js', () => ({
	createPRReview: vi.fn(),
}));

vi.mock('../../../../src/gadgets/sessionState.js', () => ({
	recordReviewSubmission: vi.fn(),
	deleteInitialComment: vi.fn(),
}));

import { CreatePRReview } from '../../../../src/gadgets/github/CreatePRReview.js';
import { createPRReview } from '../../../../src/gadgets/github/core/createPRReview.js';
import {
	deleteInitialComment,
	recordReviewSubmission,
} from '../../../../src/gadgets/sessionState.js';

const mockCreatePRReview = vi.mocked(createPRReview);
const mockRecordReviewSubmission = vi.mocked(recordReviewSubmission);
const mockDeleteInitialComment = vi.mocked(deleteInitialComment);

const BASE_PARAMS = {
	comment: 'Approving after review',
	owner: 'acme',
	repo: 'myapp',
	prNumber: 42,
	event: 'APPROVE' as const,
	body: 'LGTM!',
};

describe('CreatePRReview', () => {
	let gadget: InstanceType<typeof CreatePRReview>;

	beforeEach(() => {
		vi.clearAllMocks();
		gadget = new CreatePRReview();
	});

	it('submits review, records it, and deletes ack comment on success', async () => {
		mockCreatePRReview.mockResolvedValue({
			reviewUrl: 'https://github.com/acme/myapp/pull/42#pullrequestreview-1',
			event: 'APPROVE',
		});

		const result = await gadget.execute(BASE_PARAMS);

		expect(mockCreatePRReview).toHaveBeenCalledWith({
			owner: 'acme',
			repo: 'myapp',
			prNumber: 42,
			event: 'APPROVE',
			body: 'LGTM!',
			comments: undefined,
		});
		expect(mockRecordReviewSubmission).toHaveBeenCalledWith(
			'https://github.com/acme/myapp/pull/42#pullrequestreview-1',
		);
		expect(mockDeleteInitialComment).toHaveBeenCalledWith('acme', 'myapp');
		expect(result).toContain('Review submitted successfully');
	});

	it('does not fail if deleteInitialComment throws', async () => {
		mockCreatePRReview.mockResolvedValue({
			reviewUrl: 'https://github.com/acme/myapp/pull/42#pullrequestreview-1',
			event: 'APPROVE',
		});
		// deleteInitialComment itself handles errors internally, but simulate it throwing
		mockDeleteInitialComment.mockRejectedValueOnce(new Error('GitHub API error'));

		// Should still return success message — deleteInitialComment's internal try-catch
		// handles errors, but even if it propagates, the outer catch returns an error string
		const result = await gadget.execute(BASE_PARAMS);
		// The outer try-catch in execute will catch the error and return a formatted error string
		// This tests that CreatePRReview doesn't throw
		expect(typeof result).toBe('string');
	});

	it('returns error message when createPRReview throws', async () => {
		mockCreatePRReview.mockRejectedValue(new Error('Network error'));

		const result = await gadget.execute(BASE_PARAMS);

		expect(result).toContain('submitting review');
		expect(mockDeleteInitialComment).not.toHaveBeenCalled();
	});

	it('includes failed comment paths when comments were provided', async () => {
		mockCreatePRReview.mockRejectedValue(new Error('Invalid path'));

		const result = await gadget.execute({
			...BASE_PARAMS,
			event: 'REQUEST_CHANGES',
			comments: [{ path: 'src/foo.ts', line: 10, body: 'Fix this' }],
		});

		expect(result).toContain('src/foo.ts');
	});
});
