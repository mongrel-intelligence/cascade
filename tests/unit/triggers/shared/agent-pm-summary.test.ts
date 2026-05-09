import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockGetSessionState,
	mockPostReviewToPM,
	mockPostAgentOutputToPM,
	mockPM_SUMMARY_AGENT_TYPES,
	mockIsOutputBasedAgent,
	mockLookupWorkItemForPR,
	mockLogger,
} = vi.hoisted(() => ({
	mockGetSessionState: vi.fn().mockReturnValue({}),
	mockPostReviewToPM: vi.fn().mockResolvedValue(undefined),
	mockPostAgentOutputToPM: vi.fn().mockResolvedValue(undefined),
	mockPM_SUMMARY_AGENT_TYPES: new Set([
		'review',
		'respond-to-ci',
		'respond-to-review',
		'respond-to-pr-comment',
		'resolve-conflicts',
	]),
	mockIsOutputBasedAgent: vi
		.fn()
		.mockImplementation((agentType: string) =>
			['respond-to-ci', 'respond-to-review', 'respond-to-pr-comment', 'resolve-conflicts'].includes(
				agentType,
			),
		),
	mockLookupWorkItemForPR: vi.fn().mockResolvedValue(null),
	mockLogger: {
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock('../../../../src/gadgets/sessionState.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../src/gadgets/sessionState.js')>();
	return {
		...actual,
		getSessionState: mockGetSessionState,
	};
});

vi.mock('../../../../src/triggers/shared/agent-pm-poster.js', () => ({
	postReviewToPM: mockPostReviewToPM,
	postAgentOutputToPM: mockPostAgentOutputToPM,
	PM_SUMMARY_AGENT_TYPES: mockPM_SUMMARY_AGENT_TYPES,
	isOutputBasedAgent: mockIsOutputBasedAgent,
}));

vi.mock('../../../../src/db/repositories/prWorkItemsRepository.js', () => ({
	lookupWorkItemForPR: mockLookupWorkItemForPR,
}));

vi.mock('../../../../src/utils/logging.js', () => ({
	logger: mockLogger,
}));

import { postAgentSummaryToPM } from '../../../../src/triggers/shared/agent-pm-summary.js';

describe('postAgentSummaryToPM', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetSessionState.mockReturnValue({});
		mockLookupWorkItemForPR.mockResolvedValue(null);
	});

	it('calls postReviewToPM when agentType=review, success, and sessionState has reviewBody', async () => {
		mockGetSessionState.mockReturnValue({
			reviewBody: 'Looks good',
			reviewEvent: 'APPROVE',
			reviewUrl: 'https://github.com/acme/myapp/pull/42#pullrequestreview-1',
		});

		await postAgentSummaryToPM(
			'review',
			{ success: true, output: '', runId: 'run-rev', progressCommentId: 'pm-comment-1' },
			'card-1',
			'project-1',
			42,
		);

		expect(mockPostReviewToPM).toHaveBeenCalledWith(
			'card-1',
			expect.objectContaining({ reviewBody: 'Looks good' }),
			'pm-comment-1',
		);
	});

	it('skips PM posting entirely for non-summary agent types', async () => {
		mockGetSessionState.mockReturnValue({ reviewBody: 'something' });

		await postAgentSummaryToPM(
			'implementation',
			{ success: true, output: '', runId: 'run-impl' },
			'card-1',
			'project-1',
			undefined,
		);

		expect(mockPostReviewToPM).not.toHaveBeenCalled();
		expect(mockPostAgentOutputToPM).not.toHaveBeenCalled();
		expect(mockGetSessionState).not.toHaveBeenCalled();
	});

	it('skips when agent failed', async () => {
		mockGetSessionState.mockReturnValue({ reviewBody: 'Looks good' });

		await postAgentSummaryToPM(
			'review',
			{ success: false, output: '', error: 'review error' },
			'card-1',
			'project-1',
			undefined,
		);

		expect(mockPostReviewToPM).not.toHaveBeenCalled();
		expect(mockGetSessionState).not.toHaveBeenCalled();
	});

	it('skips when sessionState has no reviewBody and logs reason', async () => {
		mockGetSessionState.mockReturnValue({ reviewBody: null });

		await postAgentSummaryToPM(
			'review',
			{ success: true, output: '', runId: 'run-rev' },
			'card-1',
			'project-1',
			undefined,
		);

		expect(mockPostReviewToPM).not.toHaveBeenCalled();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'Review PM posting skipped: no reviewBody in session state',
		);
	});

	it('resolves workItemId from DB when result.workItemId is undefined', async () => {
		mockGetSessionState.mockReturnValue({
			reviewBody: 'Nice',
			reviewEvent: 'COMMENT',
			reviewUrl: 'https://github.com/acme/myapp/pull/99#pullrequestreview-5',
		});
		mockLookupWorkItemForPR.mockResolvedValueOnce('card-from-db');

		await postAgentSummaryToPM(
			'review',
			{ success: true, output: '', runId: 'run-rev' },
			undefined,
			'project-1',
			99,
		);

		expect(mockLookupWorkItemForPR).toHaveBeenCalledWith('project-1', 99);
		expect(mockPostReviewToPM).toHaveBeenCalledWith(
			'card-from-db',
			expect.objectContaining({ reviewBody: 'Nice' }),
			undefined,
		);
	});

	it('skips when no workItemId found and logs reason', async () => {
		mockGetSessionState.mockReturnValue({
			reviewBody: 'Good',
			reviewEvent: 'APPROVE',
			reviewUrl: 'https://github.com/acme/myapp/pull/55#pullrequestreview-6',
		});
		mockLookupWorkItemForPR.mockResolvedValueOnce(null);

		await postAgentSummaryToPM(
			'review',
			{ success: true, output: '', runId: 'run-rev' },
			undefined,
			'project-1',
			55,
		);

		expect(mockPostReviewToPM).not.toHaveBeenCalled();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			'Agent PM posting skipped: no workItemId found',
			expect.objectContaining({ agentType: 'review', projectId: 'project-1', prNumber: 55 }),
		);
	});

	it.each([
		['respond-to-ci', 'Fixed CI by updating the build config.'],
		['respond-to-review', 'Addressed all review comments.'],
		['respond-to-pr-comment', 'Answered the PR comment.'],
		['resolve-conflicts', 'Resolved merge conflicts in 3 files.'],
	])('calls postAgentOutputToPM for %s with successful result', async (agentType, output) => {
		await postAgentSummaryToPM(
			agentType,
			{ success: true, output, runId: 'run-output', progressCommentId: 'pm-prog' },
			'card-2',
			'project-1',
			10,
		);

		expect(mockPostAgentOutputToPM).toHaveBeenCalledWith('card-2', agentType, output, 'pm-prog');
		expect(mockPostReviewToPM).not.toHaveBeenCalled();
	});

	it('delegates empty output to postAgentOutputToPM', async () => {
		await postAgentSummaryToPM(
			'respond-to-ci',
			{ success: true, output: '', runId: 'run-ci-empty' },
			'card-5',
			'project-1',
			undefined,
		);

		expect(mockPostAgentOutputToPM).toHaveBeenCalledWith('card-5', 'respond-to-ci', '', undefined);
	});

	it('does not call postAgentOutputToPM when agent failed', async () => {
		await postAgentSummaryToPM(
			'respond-to-ci',
			{ success: false, output: 'Some output before failure.', error: 'CI fix failed' },
			'card-6',
			'project-1',
			undefined,
		);

		expect(mockPostAgentOutputToPM).not.toHaveBeenCalled();
		expect(mockPostReviewToPM).not.toHaveBeenCalled();
	});
});
