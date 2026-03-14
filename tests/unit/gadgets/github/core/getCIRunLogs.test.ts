import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/github/client.js', () => ({
	githubClient: {
		getFailedWorkflowRunJobs: vi.fn(),
	},
}));

import { getCIRunLogs } from '../../../../../src/gadgets/github/core/getCIRunLogs.js';
import { githubClient } from '../../../../../src/github/client.js';

const mockGetFailedJobs = vi.mocked(githubClient.getFailedWorkflowRunJobs);

describe('getCIRunLogs', () => {
	it('returns formatted log output for failed runs', async () => {
		mockGetFailedJobs.mockResolvedValue({
			runs: [{ id: 100, name: 'CI' }],
			failedJobs: [
				{
					runName: 'CI',
					runId: 100,
					jobName: 'test',
					conclusion: 'failure',
					steps: [
						{ name: 'Run tests', conclusion: 'failure' },
						{ name: 'Setup Node', conclusion: 'success' },
					],
				},
			],
		});

		const result = await getCIRunLogs('acme', 'myapp', 'abc123');

		expect(result).toContain('1 failed workflow run');
		expect(result).toContain('CI > test (failure)');
		expect(result).toContain('Run tests (failure)');
		expect(result).toContain('Tip: Use Tmux');
	});

	it('handles no failed runs gracefully', async () => {
		mockGetFailedJobs.mockResolvedValue({ runs: [], failedJobs: [] });

		const result = await getCIRunLogs('acme', 'myapp', 'abc123');

		expect(result).toContain('No failed workflow runs');
	});

	it('handles API errors gracefully', async () => {
		mockGetFailedJobs.mockRejectedValue(new Error('API rate limit'));

		const result = await getCIRunLogs('acme', 'myapp', 'abc123');

		expect(result).toContain('Error fetching CI run logs');
		expect(result).toContain('API rate limit');
	});
});
