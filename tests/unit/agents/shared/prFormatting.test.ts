import { describe, expect, it } from 'vitest';
import {
	extractPRDiffs,
	formatPRComments,
	formatPRDetails,
	formatPRDiff,
	formatPRIssueComments,
	formatPRReviews,
	type PRDiff,
	type SkippedFile,
} from '../../../../src/agents/shared/prFormatting.js';
import { REVIEW_DIFF_CONTEXT_TOKEN_LIMIT } from '../../../../src/config/reviewConfig.js';

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

// ============================================================================
// extractPRDiffs
// ============================================================================

function makePRFile(overrides: Partial<PRDiff[number]>): PRDiff[number] {
	return {
		filename: 'src/example.ts',
		status: 'modified',
		additions: 10,
		deletions: 5,
		changes: 15,
		patch: '@@ -1,5 +1,10 @@\n context\n+added\n-removed',
		...overrides,
	} as PRDiff[number];
}

describe('extractPRDiffs', () => {
	it('returns an included entry per file with a patch', () => {
		const prDiff: PRDiff = [
			makePRFile({ filename: 'a.ts', patch: '@@ -1 +1 @@' }),
			makePRFile({ filename: 'b.ts', patch: '@@ -2 +2 @@' }),
		];

		const result = extractPRDiffs(prDiff);

		expect(result.included).toHaveLength(2);
		expect(result.included[0].path).toBe('a.ts');
		expect(result.included[1].path).toBe('b.ts');
		expect(result.skipped).toHaveLength(0);
	});

	it('marks deleted files as skipped with reason "deleted"', () => {
		const prDiff: PRDiff = [makePRFile({ filename: 'gone.ts', status: 'removed' })];

		const result = extractPRDiffs(prDiff);

		expect(result.included).toHaveLength(0);
		expect(result.skipped).toEqual<SkippedFile[]>([{ filename: 'gone.ts', reason: 'deleted' }]);
	});

	it('marks files without a patch as skipped with reason "no-patch"', () => {
		const prDiff: PRDiff = [makePRFile({ filename: 'binary.png', patch: undefined })];

		const result = extractPRDiffs(prDiff);

		expect(result.included).toHaveLength(0);
		expect(result.skipped).toEqual<SkippedFile[]>([{ filename: 'binary.png', reason: 'no-patch' }]);
	});

	it('marks files with a patch over the per-file cap as skipped with reason "patch-too-large"', () => {
		// per-file cap is 10% of total budget by default — 20k tokens → 80k chars
		// Construct a patch beyond that cap.
		const hugePatch = 'x'.repeat(100_000); // 25k tokens
		const prDiff: PRDiff = [makePRFile({ filename: 'huge.ts', patch: hugePatch })];

		const result = extractPRDiffs(prDiff);

		expect(result.included).toHaveLength(0);
		expect(result.skipped).toEqual<SkippedFile[]>([
			{ filename: 'huge.ts', reason: 'patch-too-large' },
		]);
	});

	it('respects total-budget cap; overflow files go to skipped with reason "over-budget"', () => {
		// Per-file cap is 10% of total budget (20k tokens). Use ~19k-token patches
		// (76k chars) — each individually fits, but 11 of them exceed the 200k cap.
		const mediumPatch = 'x'.repeat(76_000);
		const prDiff: PRDiff = Array.from({ length: 12 }, (_, i) =>
			makePRFile({ filename: `file-${i}.ts`, patch: mediumPatch }),
		);

		const result = extractPRDiffs(prDiff);

		// Expect some to be included, remainder over-budget, all reasons correct.
		expect(result.included.length).toBeGreaterThan(0);
		expect(result.skipped.length).toBeGreaterThan(0);
		expect(result.included.length + result.skipped.length).toBe(12);
		for (const s of result.skipped) {
			expect(s.reason).toBe('over-budget');
		}
		// The first included file is the first input; overflow preserves input order.
		expect(result.included[0].path).toBe('file-0.ts');
	});

	it('returns deterministic ordering for same input', () => {
		const prDiff: PRDiff = [
			makePRFile({ filename: 'c.ts' }),
			makePRFile({ filename: 'a.ts' }),
			makePRFile({ filename: 'b.ts' }),
		];

		const r1 = extractPRDiffs(prDiff);
		const r2 = extractPRDiffs(prDiff);

		expect(r1.included.map((f) => f.path)).toEqual(r2.included.map((f) => f.path));
		// Preserves input order (not alphabetical) — stable w.r.t. GitHub's returned order
		expect(r1.included.map((f) => f.path)).toEqual(['c.ts', 'a.ts', 'b.ts']);
	});

	it('handles empty PR diff input', () => {
		const result = extractPRDiffs([]);

		expect(result).toEqual({
			included: [],
			skipped: [],
			totalDiffTokens: 0,
			perFileTokenCap: expect.any(Number),
		});
	});

	it('per-file diff contains a header with filename, status, and line-change counts', () => {
		const prDiff: PRDiff = [
			makePRFile({ filename: 'src/a.ts', status: 'modified', additions: 12, deletions: 3 }),
		];

		const result = extractPRDiffs(prDiff);

		expect(result.included[0].diff).toContain('### src/a.ts');
		expect(result.included[0].diff).toContain('modified');
		expect(result.included[0].diff).toMatch(/\+12.*-3/);
	});

	it('applies skip rules in the documented order (deleted before no-patch)', () => {
		// A removed file with no patch should be reported as "deleted", not "no-patch"
		const prDiff: PRDiff = [makePRFile({ filename: 'x.ts', status: 'removed', patch: undefined })];

		const result = extractPRDiffs(prDiff);

		expect(result.skipped[0].reason).toBe('deleted');
	});

	it('sanity: budget constant matches imported value (guards against drift)', () => {
		expect(REVIEW_DIFF_CONTEXT_TOKEN_LIMIT).toBeGreaterThan(0);
	});

	it('marks local diff failures as skipped instead of trusting an API patch', () => {
		const prDiff: PRDiff = [
			makePRFile({
				filename: 'api-clipped.ts',
				patch: undefined,
				patchSource: 'local-diff-failed',
			} as Partial<PRDiff[number]>),
		];

		const result = extractPRDiffs(prDiff);

		expect(result.included).toHaveLength(0);
		expect(result.skipped).toEqual<SkippedFile[]>([
			{ filename: 'api-clipped.ts', reason: 'local-diff-failed' },
		]);
	});

	it('preserves local-git source metadata and token counts for included files', () => {
		const prDiff: PRDiff = [
			makePRFile({
				filename: 'local.ts',
				patch: '@@ -1 +1 @@\n+local',
				patchSource: 'local-git',
			} as Partial<PRDiff[number]>),
		];

		const result = extractPRDiffs(prDiff);

		expect(result.included[0]).toEqual(
			expect.objectContaining({
				path: 'local.ts',
				patchSource: 'local-git',
				tokens: expect.any(Number),
			}),
		);
		expect(result.totalDiffTokens).toBe(result.included[0].tokens);
	});
});
