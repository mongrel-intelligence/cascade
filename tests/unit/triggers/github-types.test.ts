import { describe, expect, it } from 'vitest';
import {
	isGitHubCheckSuitePayload,
	isGitHubIssueCommentPayload,
	isGitHubPRReviewCommentPayload,
	isGitHubPullRequestPayload,
	isGitHubPullRequestReviewPayload,
} from '../../../src/triggers/github/types.js';

describe('GitHub Type Guards', () => {
	describe('isGitHubPRReviewCommentPayload', () => {
		const validPayload = {
			action: 'created',
			comment: {
				id: 1,
				body: 'test',
				path: 'src/index.ts',
				line: 10,
				user: { login: 'user1' },
				html_url: 'https://github.com/...',
			},
			pull_request: {
				number: 1,
				title: 'PR',
				html_url: 'https://github.com/...',
				head: { ref: 'feat', sha: 'abc' },
				base: { ref: 'main' },
			},
			repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
			sender: { login: 'user1' },
		};

		it('returns true for valid payload', () => {
			expect(isGitHubPRReviewCommentPayload(validPayload)).toBe(true);
		});

		it('returns false for null', () => {
			expect(isGitHubPRReviewCommentPayload(null)).toBe(false);
		});

		it('returns false for undefined', () => {
			expect(isGitHubPRReviewCommentPayload(undefined)).toBe(false);
		});

		it('returns false for primitive', () => {
			expect(isGitHubPRReviewCommentPayload('string')).toBe(false);
			expect(isGitHubPRReviewCommentPayload(42)).toBe(false);
		});

		it('returns false when action is missing', () => {
			const { action, ...rest } = validPayload;
			expect(isGitHubPRReviewCommentPayload(rest)).toBe(false);
		});

		it('returns false when comment is missing', () => {
			const { comment, ...rest } = validPayload;
			expect(isGitHubPRReviewCommentPayload(rest)).toBe(false);
		});

		it('returns false when comment is null', () => {
			expect(isGitHubPRReviewCommentPayload({ ...validPayload, comment: null })).toBe(false);
		});

		it('returns false when pull_request is missing', () => {
			const { pull_request, ...rest } = validPayload;
			expect(isGitHubPRReviewCommentPayload(rest)).toBe(false);
		});

		it('returns false when repository is missing', () => {
			const { repository, ...rest } = validPayload;
			expect(isGitHubPRReviewCommentPayload(rest)).toBe(false);
		});

		it('returns false when repository is null', () => {
			expect(isGitHubPRReviewCommentPayload({ ...validPayload, repository: null })).toBe(false);
		});
	});

	describe('isGitHubCheckSuitePayload', () => {
		const validPayload = {
			action: 'completed',
			check_suite: {
				id: 1,
				status: 'completed',
				conclusion: 'success',
				head_sha: 'abc',
				pull_requests: [],
			},
			repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
			sender: { login: 'user1' },
		};

		it('returns true for valid payload', () => {
			expect(isGitHubCheckSuitePayload(validPayload)).toBe(true);
		});

		it('returns false for null', () => {
			expect(isGitHubCheckSuitePayload(null)).toBe(false);
		});

		it('returns false for undefined', () => {
			expect(isGitHubCheckSuitePayload(undefined)).toBe(false);
		});

		it('returns false for primitive', () => {
			expect(isGitHubCheckSuitePayload(123)).toBe(false);
		});

		it('returns false when action is missing', () => {
			const { action, ...rest } = validPayload;
			expect(isGitHubCheckSuitePayload(rest)).toBe(false);
		});

		it('returns false when check_suite is missing', () => {
			const { check_suite, ...rest } = validPayload;
			expect(isGitHubCheckSuitePayload(rest)).toBe(false);
		});

		it('returns false when check_suite is null', () => {
			expect(isGitHubCheckSuitePayload({ ...validPayload, check_suite: null })).toBe(false);
		});

		it('returns false when repository is missing', () => {
			const { repository, ...rest } = validPayload;
			expect(isGitHubCheckSuitePayload(rest)).toBe(false);
		});
	});

	describe('isGitHubPullRequestReviewPayload', () => {
		const validPayload = {
			action: 'submitted',
			review: {
				id: 1,
				state: 'approved',
				body: 'LGTM',
				html_url: 'https://github.com/...',
				user: { login: 'reviewer' },
			},
			pull_request: {
				number: 1,
				title: 'PR',
				body: 'desc',
				html_url: 'https://github.com/...',
				head: { ref: 'feat', sha: 'abc' },
				base: { ref: 'main' },
			},
			repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
			sender: { login: 'reviewer' },
		};

		it('returns true for valid payload', () => {
			expect(isGitHubPullRequestReviewPayload(validPayload)).toBe(true);
		});

		it('returns false for null', () => {
			expect(isGitHubPullRequestReviewPayload(null)).toBe(false);
		});

		it('returns false for undefined', () => {
			expect(isGitHubPullRequestReviewPayload(undefined)).toBe(false);
		});

		it('returns false for primitive', () => {
			expect(isGitHubPullRequestReviewPayload('hello')).toBe(false);
		});

		it('returns false when review is missing', () => {
			const { review, ...rest } = validPayload;
			expect(isGitHubPullRequestReviewPayload(rest)).toBe(false);
		});

		it('returns false when review is null', () => {
			expect(isGitHubPullRequestReviewPayload({ ...validPayload, review: null })).toBe(false);
		});

		it('returns false when pull_request is missing', () => {
			const { pull_request, ...rest } = validPayload;
			expect(isGitHubPullRequestReviewPayload(rest)).toBe(false);
		});

		it('returns false when pull_request is null', () => {
			expect(isGitHubPullRequestReviewPayload({ ...validPayload, pull_request: null })).toBe(false);
		});

		it('returns false when repository is missing', () => {
			const { repository, ...rest } = validPayload;
			expect(isGitHubPullRequestReviewPayload(rest)).toBe(false);
		});
	});

	describe('isGitHubPullRequestPayload', () => {
		const validPayload = {
			action: 'opened',
			number: 42,
			pull_request: {
				number: 42,
				title: 'PR',
				body: 'desc',
				html_url: 'https://github.com/...',
				state: 'open',
				draft: false,
				head: { ref: 'feat', sha: 'abc' },
				base: { ref: 'main' },
				user: { login: 'author' },
			},
			repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
			sender: { login: 'author' },
		};

		it('returns true for valid payload', () => {
			expect(isGitHubPullRequestPayload(validPayload)).toBe(true);
		});

		it('returns false for null', () => {
			expect(isGitHubPullRequestPayload(null)).toBe(false);
		});

		it('returns false for undefined', () => {
			expect(isGitHubPullRequestPayload(undefined)).toBe(false);
		});

		it('returns false for primitive', () => {
			expect(isGitHubPullRequestPayload(true)).toBe(false);
		});

		it('returns false when action is missing', () => {
			const { action, ...rest } = validPayload;
			expect(isGitHubPullRequestPayload(rest)).toBe(false);
		});

		it('returns false when number is missing', () => {
			const { number, ...rest } = validPayload;
			expect(isGitHubPullRequestPayload(rest)).toBe(false);
		});

		it('returns false when number is not a number', () => {
			expect(isGitHubPullRequestPayload({ ...validPayload, number: 'not-a-number' })).toBe(false);
		});

		it('returns false when pull_request is missing', () => {
			const { pull_request, ...rest } = validPayload;
			expect(isGitHubPullRequestPayload(rest)).toBe(false);
		});

		it('returns false when pull_request is null', () => {
			expect(isGitHubPullRequestPayload({ ...validPayload, pull_request: null })).toBe(false);
		});

		it('returns false when repository is missing', () => {
			const { repository, ...rest } = validPayload;
			expect(isGitHubPullRequestPayload(rest)).toBe(false);
		});

		it('returns false when repository is null', () => {
			expect(isGitHubPullRequestPayload({ ...validPayload, repository: null })).toBe(false);
		});
	});

	describe('isGitHubIssueCommentPayload', () => {
		const validPayload = {
			action: 'created',
			issue: {
				number: 1,
				title: 'Issue',
				html_url: 'https://github.com/...',
				pull_request: { url: 'https://api.github.com/...' },
			},
			comment: {
				id: 1,
				body: 'test comment',
				html_url: 'https://github.com/...',
				user: { login: 'commenter' },
			},
			repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
			sender: { login: 'commenter' },
		};

		it('returns true for valid payload', () => {
			expect(isGitHubIssueCommentPayload(validPayload)).toBe(true);
		});

		it('returns false for null', () => {
			expect(isGitHubIssueCommentPayload(null)).toBe(false);
		});

		it('returns false for undefined', () => {
			expect(isGitHubIssueCommentPayload(undefined)).toBe(false);
		});

		it('returns false for primitive', () => {
			expect(isGitHubIssueCommentPayload(0)).toBe(false);
		});

		it('returns false when action is missing', () => {
			const { action, ...rest } = validPayload;
			expect(isGitHubIssueCommentPayload(rest)).toBe(false);
		});

		it('returns false when issue is missing', () => {
			const { issue, ...rest } = validPayload;
			expect(isGitHubIssueCommentPayload(rest)).toBe(false);
		});

		it('returns false when issue is null', () => {
			expect(isGitHubIssueCommentPayload({ ...validPayload, issue: null })).toBe(false);
		});

		it('returns false when comment is missing', () => {
			const { comment, ...rest } = validPayload;
			expect(isGitHubIssueCommentPayload(rest)).toBe(false);
		});

		it('returns false when comment is null', () => {
			expect(isGitHubIssueCommentPayload({ ...validPayload, comment: null })).toBe(false);
		});

		it('returns false when repository is missing', () => {
			const { repository, ...rest } = validPayload;
			expect(isGitHubIssueCommentPayload(rest)).toBe(false);
		});

		it('returns false when repository is null', () => {
			expect(isGitHubIssueCommentPayload({ ...validPayload, repository: null })).toBe(false);
		});
	});
});
