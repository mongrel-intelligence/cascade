import { describe, expect, it } from 'vitest';

import {
	formatPRComments,
	formatPRDetails,
	formatPRDiff,
	formatPRIssueComments,
	formatPRReviews,
} from '../../../../src/agents/shared/prFormatting.js';

describe('formatPRDetails', () => {
	it('formats PR details with all fields', () => {
		const pr = {
			number: 42,
			title: 'Add feature',
			state: 'open',
			headRef: 'feature/my-feature',
			baseRef: 'main',
			htmlUrl: 'https://github.com/org/repo/pull/42',
			body: 'This PR adds a new feature.',
		};

		const result = formatPRDetails(pr as Parameters<typeof formatPRDetails>[0]);

		expect(result).toContain('PR #42: Add feature');
		expect(result).toContain('State: open');
		expect(result).toContain('Branch: feature/my-feature -> main');
		expect(result).toContain('URL: https://github.com/org/repo/pull/42');
		expect(result).toContain('Description:');
		expect(result).toContain('This PR adds a new feature.');
	});

	it('shows "(no description)" when body is null', () => {
		const pr = {
			number: 1,
			title: 'No body PR',
			state: 'open',
			headRef: 'fix/bug',
			baseRef: 'main',
			htmlUrl: 'https://github.com/org/repo/pull/1',
			body: null,
		};

		const result = formatPRDetails(pr as Parameters<typeof formatPRDetails>[0]);

		expect(result).toContain('(no description)');
	});

	it('shows "(no description)" when body is empty string', () => {
		const pr = {
			number: 2,
			title: 'Empty body PR',
			state: 'closed',
			headRef: 'feat/thing',
			baseRef: 'main',
			htmlUrl: 'https://github.com/org/repo/pull/2',
			body: '',
		};

		const result = formatPRDetails(pr as Parameters<typeof formatPRDetails>[0]);

		expect(result).toContain('(no description)');
	});
});

describe('formatPRDiff', () => {
	it('returns message when no files changed', () => {
		const result = formatPRDiff([]);

		expect(result).toBe('No files changed in this PR.');
	});

	it('formats a single file with patch', () => {
		const diff = [
			{
				filename: 'src/index.ts',
				status: 'modified',
				additions: 5,
				deletions: 2,
				patch: '@@ -1,2 +1,5 @@\n+new line',
			},
		];

		const result = formatPRDiff(diff as Parameters<typeof formatPRDiff>[0]);

		expect(result).toContain('1 file(s) changed:');
		expect(result).toContain('## src/index.ts');
		expect(result).toContain('Status: modified | +5 -2');
		expect(result).toContain('```diff');
		expect(result).toContain('@@ -1,2 +1,5 @@');
	});

	it('shows binary file message when no patch', () => {
		const diff = [
			{
				filename: 'image.png',
				status: 'added',
				additions: 0,
				deletions: 0,
				patch: undefined,
			},
		];

		const result = formatPRDiff(diff as Parameters<typeof formatPRDiff>[0]);

		expect(result).toContain('[Binary file or too large to display]');
	});

	it('formats multiple files', () => {
		const diff = [
			{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, patch: '+ line' },
			{ filename: 'b.ts', status: 'added', additions: 10, deletions: 0, patch: undefined },
		];

		const result = formatPRDiff(diff as Parameters<typeof formatPRDiff>[0]);

		expect(result).toContain('2 file(s) changed:');
		expect(result).toContain('## a.ts');
		expect(result).toContain('## b.ts');
	});
});

describe('formatPRComments', () => {
	it('returns message when no comments', () => {
		const result = formatPRComments([]);

		expect(result).toBe('No review comments found.');
	});

	it('formats review comments', () => {
		const comments = [
			{
				id: 1,
				user: { login: 'alice' },
				path: 'src/index.ts',
				line: 42,
				htmlUrl: 'https://github.com/org/repo/pull/1#comment-1',
				inReplyToId: null,
				body: 'Consider refactoring this.',
			},
		];

		const result = formatPRComments(comments as Parameters<typeof formatPRComments>[0]);

		expect(result).toContain('Comment #1 by @alice');
		expect(result).toContain('File: src/index.ts:42');
		expect(result).toContain('URL: https://github.com/org/repo/pull/1#comment-1');
		expect(result).toContain('Consider refactoring this.');
		expect(result).toContain('---');
	});

	it('shows in-reply-to when present', () => {
		const comments = [
			{
				id: 2,
				user: { login: 'bob' },
				path: 'file.ts',
				line: null,
				htmlUrl: 'https://github.com/org/repo/pull/1#comment-2',
				inReplyToId: 1,
				body: 'Agreed.',
			},
		];

		const result = formatPRComments(comments as Parameters<typeof formatPRComments>[0]);

		expect(result).toContain('In reply to: #1');
	});

	it('omits line number when not present', () => {
		const comments = [
			{
				id: 3,
				user: { login: 'carol' },
				path: 'file.ts',
				line: null,
				htmlUrl: 'https://github.com/org/repo/pull/1#comment-3',
				inReplyToId: null,
				body: 'Comment',
			},
		];

		const result = formatPRComments(comments as Parameters<typeof formatPRComments>[0]);

		expect(result).toContain('File: file.ts');
		expect(result).not.toContain('file.ts:');
	});
});

describe('formatPRReviews', () => {
	it('returns message when no reviews with body text', () => {
		const result = formatPRReviews([]);

		expect(result).toBe('No review submissions with body text.');
	});

	it('filters out reviews without body', () => {
		const reviews = [
			{ user: { login: 'alice' }, state: 'APPROVED', submittedAt: '2024-01-01', body: '' },
			{ user: { login: 'bob' }, state: 'APPROVED', submittedAt: '2024-01-01', body: null },
		];

		const result = formatPRReviews(reviews as Parameters<typeof formatPRReviews>[0]);

		expect(result).toBe('No review submissions with body text.');
	});

	it('formats reviews with body text', () => {
		const reviews = [
			{
				user: { login: 'alice' },
				state: 'CHANGES_REQUESTED',
				submittedAt: '2024-01-01T00:00:00Z',
				body: 'Please fix the types.',
			},
		];

		const result = formatPRReviews(reviews as Parameters<typeof formatPRReviews>[0]);

		expect(result).toContain('Review by @alice (CHANGES_REQUESTED)');
		expect(result).toContain('Submitted: 2024-01-01T00:00:00Z');
		expect(result).toContain('Please fix the types.');
		expect(result).toContain('---');
	});

	it('filters whitespace-only body', () => {
		const reviews = [
			{ user: { login: 'alice' }, state: 'APPROVED', submittedAt: '2024-01-01', body: '   ' },
		];

		const result = formatPRReviews(reviews as Parameters<typeof formatPRReviews>[0]);

		expect(result).toBe('No review submissions with body text.');
	});
});

describe('formatPRIssueComments', () => {
	it('returns message when no comments', () => {
		const result = formatPRIssueComments([]);

		expect(result).toBe('No general PR comments found.');
	});

	it('formats issue comments', () => {
		const comments = [
			{
				id: 10,
				user: { login: 'alice' },
				htmlUrl: 'https://github.com/org/repo/pull/1#issuecomment-10',
				createdAt: '2024-01-01T00:00:00Z',
				body: 'LGTM!',
			},
		];

		const result = formatPRIssueComments(comments as Parameters<typeof formatPRIssueComments>[0]);

		expect(result).toContain('Comment #10 by @alice');
		expect(result).toContain('URL: https://github.com/org/repo/pull/1#issuecomment-10');
		expect(result).toContain('Created: 2024-01-01T00:00:00Z');
		expect(result).toContain('LGTM!');
		expect(result).toContain('---');
	});

	it('formats multiple issue comments', () => {
		const comments = [
			{
				id: 1,
				user: { login: 'alice' },
				htmlUrl: 'https://github.com/org/repo/pull/1#issuecomment-1',
				createdAt: '2024-01-01',
				body: 'First',
			},
			{
				id: 2,
				user: { login: 'bob' },
				htmlUrl: 'https://github.com/org/repo/pull/1#issuecomment-2',
				createdAt: '2024-01-02',
				body: 'Second',
			},
		];

		const result = formatPRIssueComments(comments as Parameters<typeof formatPRIssueComments>[0]);

		expect(result).toContain('Comment #1 by @alice');
		expect(result).toContain('Comment #2 by @bob');
	});
});
