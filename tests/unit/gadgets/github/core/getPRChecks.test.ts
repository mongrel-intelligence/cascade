import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/github/client.js', () => ({
	githubClient: {
		getPR: vi.fn(),
		getCheckSuiteStatus: vi.fn(),
	},
}));

import {
	formatCheckStatus,
	getPRChecks,
} from '../../../../../src/gadgets/github/core/getPRChecks.js';
import { githubClient } from '../../../../../src/github/client.js';

const mockGithub = vi.mocked(githubClient);

function makeCheckRun(overrides: Record<string, unknown> = {}) {
	return {
		name: 'ci-test',
		status: 'completed',
		conclusion: 'success',
		...overrides,
	};
}

function makeCheckStatus(overrides: Record<string, unknown> = {}) {
	return {
		totalCount: 1,
		allPassing: true,
		checkRuns: [makeCheckRun()],
		...overrides,
	};
}

describe('formatCheckStatus', () => {
	it('returns "No CI checks configured" when totalCount is 0', () => {
		const result = formatCheckStatus(1, { totalCount: 0, allPassing: true, checkRuns: [] });
		expect(result).toBe('PR #1: No CI checks configured');
	});

	it('shows passing count out of total', () => {
		const result = formatCheckStatus(
			42,
			makeCheckStatus({ totalCount: 2, checkRuns: [makeCheckRun(), makeCheckRun()] }),
		);
		expect(result).toContain('PR #42 Check Status: 2/2');
	});

	it('counts skipped checks as passing', () => {
		const result = formatCheckStatus(
			1,
			makeCheckStatus({
				totalCount: 2,
				checkRuns: [
					makeCheckRun({ conclusion: 'success' }),
					makeCheckRun({ conclusion: 'skipped' }),
				],
			}),
		);
		expect(result).toContain('2/2');
	});

	it('shows check with success icon (✓) for successful checks', () => {
		const result = formatCheckStatus(
			1,
			makeCheckStatus({ checkRuns: [makeCheckRun({ conclusion: 'success' })] }),
		);
		expect(result).toContain('✓');
		expect(result).toContain('ci-test (success)');
	});

	it('shows failure icon (✗) for failed checks', () => {
		const result = formatCheckStatus(
			1,
			makeCheckStatus({
				allPassing: false,
				checkRuns: [makeCheckRun({ conclusion: 'failure' })],
			}),
		);
		expect(result).toContain('✗');
		expect(result).toContain('ci-test (failure)');
	});

	it('shows in_progress icon (⏳) for in-progress checks', () => {
		const result = formatCheckStatus(
			1,
			makeCheckStatus({ checkRuns: [makeCheckRun({ status: 'in_progress', conclusion: null })] }),
		);
		expect(result).toContain('⏳');
	});

	it('shows queued icon (⏸) for queued checks', () => {
		const result = formatCheckStatus(
			1,
			makeCheckStatus({ checkRuns: [makeCheckRun({ status: 'queued', conclusion: null })] }),
		);
		expect(result).toContain('⏸');
	});

	it('shows cancelled icon (⊘) for cancelled checks', () => {
		const result = formatCheckStatus(
			1,
			makeCheckStatus({ checkRuns: [makeCheckRun({ conclusion: 'cancelled' })] }),
		);
		expect(result).toContain('⊘');
	});

	it('shows all passing status at the end', () => {
		const result = formatCheckStatus(1, makeCheckStatus({ allPassing: true }));
		expect(result).toContain('All checks passing: true');
	});

	it('shows all passing: false when not passing', () => {
		const result = formatCheckStatus(
			1,
			makeCheckStatus({ allPassing: false, checkRuns: [makeCheckRun({ conclusion: 'failure' })] }),
		);
		expect(result).toContain('All checks passing: false');
	});
});

describe('getPRChecks', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('fetches PR and check suite status and returns formatted output', async () => {
		mockGithub.getPR.mockResolvedValue({
			number: 5,
			headSha: 'abc123',
			title: 'Test PR',
			state: 'open',
			htmlUrl: 'https://github.com/owner/repo/pull/5',
			baseRef: 'main',
			headRef: 'feature',
			body: null,
		} as Awaited<ReturnType<typeof mockGithub.getPR>>);

		mockGithub.getCheckSuiteStatus.mockResolvedValue(
			makeCheckStatus() as Awaited<ReturnType<typeof mockGithub.getCheckSuiteStatus>>,
		);

		const result = await getPRChecks('owner', 'repo', 5);

		expect(mockGithub.getPR).toHaveBeenCalledWith('owner', 'repo', 5);
		expect(mockGithub.getCheckSuiteStatus).toHaveBeenCalledWith('owner', 'repo', 'abc123');
		expect(result).toContain('PR #5 Check Status');
	});

	it('returns error message when getPR throws', async () => {
		mockGithub.getPR.mockRejectedValue(new Error('Not found'));

		const result = await getPRChecks('owner', 'repo', 99);

		expect(result).toBe('Error fetching PR check status: Not found');
	});

	it('returns error message when getCheckSuiteStatus throws', async () => {
		mockGithub.getPR.mockResolvedValue({
			number: 5,
			headSha: 'abc123',
		} as Awaited<ReturnType<typeof mockGithub.getPR>>);
		mockGithub.getCheckSuiteStatus.mockRejectedValue(new Error('GitHub API error'));

		const result = await getPRChecks('owner', 'repo', 5);

		expect(result).toBe('Error fetching PR check status: GitHub API error');
	});

	it('handles non-Error thrown values', async () => {
		mockGithub.getPR.mockRejectedValue('string error');

		const result = await getPRChecks('owner', 'repo', 1);

		expect(result).toBe('Error fetching PR check status: string error');
	});
});
