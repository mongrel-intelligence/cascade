import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/gadgets/github/core/createPRReview.js', () => ({
	createPRReview: vi.fn(),
}));

vi.mock('../../../../src/gadgets/sessionState.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../src/gadgets/sessionState.js')>();
	return {
		...actual,
		recordReviewSubmission: vi.fn(),
		deleteInitialComment: vi.fn(),
		getProject: vi.fn(),
		getAgentType: vi.fn(),
	};
});

import { CreatePRReview } from '../../../../src/gadgets/github/CreatePRReview.js';
import { createPRReview } from '../../../../src/gadgets/github/core/createPRReview.js';
import {
	deleteInitialComment,
	getAgentType,
	getProject,
	recordReviewSubmission,
} from '../../../../src/gadgets/sessionState.js';
import type { ProjectConfig } from '../../../../src/types/index.js';

const mockCreatePRReview = vi.mocked(createPRReview);
const mockRecordReviewSubmission = vi.mocked(recordReviewSubmission);
const mockDeleteInitialComment = vi.mocked(deleteInitialComment);
const mockGetProject = vi.mocked(getProject);
const mockGetAgentType = vi.mocked(getAgentType);

const BASE_PARAMS = {
	comment: 'Approving after review',
	owner: 'acme',
	repo: 'myapp',
	prNumber: 42,
	event: 'APPROVE' as const,
	body: 'LGTM!',
};

function structuredReviewResult(
	overrides: Partial<{
		reviewUrl: string;
		event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
		advisoryEvent: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
		finalBody: string;
	}> = {},
) {
	return {
		id: '1',
		status: 'ok' as const,
		updatedAt: '2026-05-01T10:00:00Z',
		url: 'https://github.com/acme/myapp/pull/42#pullrequestreview-1',
		reviewUrl: 'https://github.com/acme/myapp/pull/42#pullrequestreview-1',
		event: 'APPROVE' as const,
		finalBody: 'LGTM!',
		repoFullName: 'acme/myapp',
		prNumber: 42,
		submittedAt: '2026-05-01T10:00:00Z',
		inlineCommentCount: 0,
		...overrides,
	};
}

describe('CreatePRReview', () => {
	let gadget: InstanceType<typeof CreatePRReview>;

	beforeEach(() => {
		gadget = new CreatePRReview();
		mockGetProject.mockReturnValue(null);
		mockGetAgentType.mockReturnValue(null);
	});

	it('submits review, records it, and deletes ack comment on success', async () => {
		mockCreatePRReview.mockResolvedValue(structuredReviewResult());

		const result = await gadget.execute(BASE_PARAMS);

		expect(mockCreatePRReview).toHaveBeenCalledWith(
			{
				owner: 'acme',
				repo: 'myapp',
				prNumber: 42,
				event: 'APPROVE',
				body: 'LGTM!',
				comments: undefined,
			},
			{ eventPolicy: 'all' },
		);
		expect(mockRecordReviewSubmission).toHaveBeenCalledWith(
			'https://github.com/acme/myapp/pull/42#pullrequestreview-1',
			'LGTM!',
			'APPROVE',
		);
		expect(mockDeleteInitialComment).toHaveBeenCalledWith('acme', 'myapp');
		expect(result).toContain('Review submitted successfully');
	});

	it('resolves the comment-only policy from SessionState and records the submitted event/body', async () => {
		mockGetProject.mockReturnValue({
			id: 'p1',
			agentReviewEventPolicies: { review: 'comment-only' },
		} as unknown as ProjectConfig);
		mockGetAgentType.mockReturnValue('review');
		const advisoryBody = '**Advisory verdict: would approve** …\n\nLGTM!';
		mockCreatePRReview.mockResolvedValue(
			structuredReviewResult({
				event: 'COMMENT',
				advisoryEvent: 'APPROVE',
				finalBody: advisoryBody,
			}),
		);

		const result = await gadget.execute(BASE_PARAMS);

		expect(mockCreatePRReview).toHaveBeenCalledWith(expect.any(Object), {
			eventPolicy: 'comment-only',
		});
		expect(mockRecordReviewSubmission).toHaveBeenCalledWith(
			'https://github.com/acme/myapp/pull/42#pullrequestreview-1',
			advisoryBody,
			'COMMENT',
		);
		expect(result).toContain('comment-only review mode');
		expect(result).toContain('advisory verdict: APPROVE');
	});

	it("resolves the 'all' policy when the project has no override for the agent type", async () => {
		mockGetProject.mockReturnValue({
			id: 'p1',
			agentReviewEventPolicies: { review: 'comment-only' },
		} as unknown as ProjectConfig);
		mockGetAgentType.mockReturnValue('implementation');
		mockCreatePRReview.mockResolvedValue(structuredReviewResult());

		await gadget.execute(BASE_PARAMS);

		expect(mockCreatePRReview).toHaveBeenCalledWith(expect.any(Object), { eventPolicy: 'all' });
	});

	it('does not fail if deleteInitialComment throws', async () => {
		mockCreatePRReview.mockResolvedValue(structuredReviewResult());
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
