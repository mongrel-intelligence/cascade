import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/github/client.js', () => ({
	githubClient: {
		getPRDiff: vi.fn(),
	},
}));

import { getPRDiff } from '../../../../../src/gadgets/github/core/getPRDiff.js';
import { githubClient } from '../../../../../src/github/client.js';

const mockGithub = vi.mocked(githubClient);

describe('getPRDiff', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns formatted diff output with file count and patches on success', async () => {
		mockGithub.getPRDiff.mockResolvedValue([
			{
				filename: 'src/foo.ts',
				status: 'modified',
				additions: 5,
				deletions: 2,
				patch: '@@ -1,2 +1,5 @@\n-old line\n+new line\n+another line',
			},
		] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>);

		const result = await getPRDiff('owner', 'repo', 42);

		expect(result).toContain('1 file(s) changed:');
		expect(result).toContain('## src/foo.ts');
		expect(result).toContain('Status: modified | +5 -2');
		expect(result).toContain('```diff');
		expect(result).toContain('@@ -1,2 +1,5 @@');
		expect(result).toContain('```');
	});

	it('uses "[Binary file or too large to display]" for files without patch', async () => {
		mockGithub.getPRDiff.mockResolvedValue([
			{
				filename: 'assets/image.png',
				status: 'added',
				additions: 0,
				deletions: 0,
				patch: undefined,
			},
		] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>);

		const result = await getPRDiff('owner', 'repo', 42);

		expect(result).toContain('1 file(s) changed:');
		expect(result).toContain('## assets/image.png');
		expect(result).toContain('[Binary file or too large to display]');
		expect(result).not.toContain('```diff');
	});

	it('returns "No files changed" when file list is empty', async () => {
		mockGithub.getPRDiff.mockResolvedValue([] as Awaited<ReturnType<typeof mockGithub.getPRDiff>>);

		const result = await getPRDiff('owner', 'repo', 42);

		expect(result).toBe('No files changed in this PR.');
	});

	it('returns error message string when githubClient throws', async () => {
		mockGithub.getPRDiff.mockRejectedValue(new Error('API rate limit exceeded'));

		const result = await getPRDiff('owner', 'repo', 42);

		expect(result).toBe('Error fetching PR diff: API rate limit exceeded');
	});
});
