import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/github/client.js', () => ({
	githubClient: {
		createPRReview: vi.fn(),
	},
}));

vi.mock('../../../../../src/utils/runLink.js', () => ({
	buildRunLinkFooterFromEnv: vi.fn(),
}));

import { buildAdvisoryPreamble } from '../../../../../src/config/reviewEventPolicy.js';
import { createPRReview } from '../../../../../src/gadgets/github/core/createPRReview.js';
import { githubClient } from '../../../../../src/github/client.js';
import { buildRunLinkFooterFromEnv } from '../../../../../src/utils/runLink.js';

const mockGithub = vi.mocked(githubClient);
const mockBuildRunLinkFooter = vi.mocked(buildRunLinkFooterFromEnv);

const BASE_PARAMS = {
	owner: 'acme',
	repo: 'myapp',
	prNumber: 42,
	event: 'REQUEST_CHANGES' as const,
	body: 'Two blocking issues in error handling.',
};

function githubReview() {
	return {
		id: 7,
		htmlUrl: 'https://github.com/acme/myapp/pull/42#pullrequestreview-7',
		body: 'irrelevant',
		state: 'CHANGES_REQUESTED',
		submittedAt: '2026-07-10T10:00:00Z',
	} as Awaited<ReturnType<typeof mockGithub.createPRReview>>;
}

describe('createPRReview core', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockBuildRunLinkFooter.mockReturnValue(null);
		mockGithub.createPRReview.mockResolvedValue(githubReview());
	});

	it('passes the requested event and body through when no policy option is given', async () => {
		const result = await createPRReview(BASE_PARAMS);

		expect(mockGithub.createPRReview).toHaveBeenCalledWith(
			'acme',
			'myapp',
			42,
			'REQUEST_CHANGES',
			BASE_PARAMS.body,
			undefined,
		);
		expect(result.event).toBe('REQUEST_CHANGES');
		expect(result.advisoryEvent).toBeUndefined();
		expect(result.finalBody).toBe(BASE_PARAMS.body);
	});

	it("passes through under an explicit 'all' policy", async () => {
		const result = await createPRReview(BASE_PARAMS, { eventPolicy: 'all' });

		expect(mockGithub.createPRReview).toHaveBeenCalledWith(
			'acme',
			'myapp',
			42,
			'REQUEST_CHANGES',
			BASE_PARAMS.body,
			undefined,
		);
		expect(result.event).toBe('REQUEST_CHANGES');
		expect(result.advisoryEvent).toBeUndefined();
	});

	for (const event of ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] as const) {
		it(`downgrades ${event} to an advisory COMMENT under the comment-only policy`, async () => {
			const result = await createPRReview(
				{ ...BASE_PARAMS, event },
				{ eventPolicy: 'comment-only' },
			);

			const expectedBody = `${buildAdvisoryPreamble(event)}\n\n${BASE_PARAMS.body}`;
			expect(mockGithub.createPRReview).toHaveBeenCalledWith(
				'acme',
				'myapp',
				42,
				'COMMENT',
				expectedBody,
				undefined,
			);
			expect(result.event).toBe('COMMENT');
			expect(result.advisoryEvent).toBe(event);
			expect(result.finalBody).toBe(expectedBody);
		});
	}

	it('appends the run-link footer after the advisory preamble body, excluded from finalBody', async () => {
		const footer = '\n\n[Run details](https://example.com/run/1)';
		mockBuildRunLinkFooter.mockReturnValue(footer);

		const result = await createPRReview(BASE_PARAMS, { eventPolicy: 'comment-only' });

		const advisoryBody = `${buildAdvisoryPreamble('REQUEST_CHANGES')}\n\n${BASE_PARAMS.body}`;
		expect(mockGithub.createPRReview).toHaveBeenCalledWith(
			'acme',
			'myapp',
			42,
			'COMMENT',
			advisoryBody + footer,
			undefined,
		);
		expect(result.finalBody).toBe(advisoryBody);
	});

	it('returns the structured result fields (url alias, PR identity, comment count)', async () => {
		const result = await createPRReview({
			...BASE_PARAMS,
			comments: [{ path: 'src/foo.ts', line: 3, body: 'nit' }],
		});

		expect(result.reviewUrl).toBe('https://github.com/acme/myapp/pull/42#pullrequestreview-7');
		expect(result.repoFullName).toBe('acme/myapp');
		expect(result.prNumber).toBe(42);
		expect(result.inlineCommentCount).toBe(1);
		expect(result.submittedAt).toBe('2026-07-10T10:00:00Z');
	});

	it('throws when the GitHub client throws (no prose sentinel)', async () => {
		mockGithub.createPRReview.mockRejectedValue(new Error('Forbidden'));

		await expect(createPRReview(BASE_PARAMS, { eventPolicy: 'comment-only' })).rejects.toThrow(
			'Forbidden',
		);
	});
});
