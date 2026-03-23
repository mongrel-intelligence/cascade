import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/github/client.js', () => ({
	githubClient: {
		getPR: vi.fn(),
	},
}));

import { getPRDetails } from '../../../../../src/gadgets/github/core/getPRDetails.js';
import { githubClient } from '../../../../../src/github/client.js';

const mockGithub = vi.mocked(githubClient);

describe('getPRDetails', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns formatted string with title, state, branch, URL, and body on success', async () => {
		mockGithub.getPR.mockResolvedValue({
			number: 42,
			title: 'My feature PR',
			state: 'open',
			headRef: 'feature/my-branch',
			baseRef: 'main',
			htmlUrl: 'https://github.com/owner/repo/pull/42',
			body: 'This PR adds a new feature.',
		} as Awaited<ReturnType<typeof mockGithub.getPR>>);

		const result = await getPRDetails('owner', 'repo', 42);

		expect(result).toBe(
			[
				'PR #42: My feature PR',
				'State: open',
				'Branch: feature/my-branch -> main',
				'URL: https://github.com/owner/repo/pull/42',
				'',
				'Description:',
				'This PR adds a new feature.',
			].join('\n'),
		);
	});

	it('uses "(no description)" when PR body is empty', async () => {
		mockGithub.getPR.mockResolvedValue({
			number: 10,
			title: 'Empty body PR',
			state: 'closed',
			headRef: 'fix/bug',
			baseRef: 'main',
			htmlUrl: 'https://github.com/owner/repo/pull/10',
			body: '',
		} as Awaited<ReturnType<typeof mockGithub.getPR>>);

		const result = await getPRDetails('owner', 'repo', 10);

		expect(result).toContain('(no description)');
	});

	it('returns error message string when githubClient throws', async () => {
		mockGithub.getPR.mockRejectedValue(new Error('Not Found'));

		const result = await getPRDetails('owner', 'repo', 99);

		expect(result).toBe('Error fetching PR details: Not Found');
	});
});
