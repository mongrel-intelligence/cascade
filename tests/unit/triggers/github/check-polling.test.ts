import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/github/client.js', () => ({
	withGitHubToken: vi.fn().mockImplementation((_token: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../../../../src/utils/repo.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../src/utils/repo.js')>();
	return {
		...actual,
		parseRepoFullName: vi.fn().mockReturnValue({ owner: 'acme', repo: 'myapp' }),
	};
});

vi.mock('../../../../src/utils/index.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

// Mock the dynamic import of check-suite-success.js
vi.mock('../../../../src/triggers/github/check-suite-success.js', () => ({
	waitForChecks: vi.fn(),
}));

import { withGitHubToken } from '../../../../src/github/client.js';
import { pollWaitForChecks } from '../../../../src/triggers/github/check-polling.js';
import type { TriggerResult } from '../../../../src/triggers/types.js';
import { parseRepoFullName } from '../../../../src/utils/repo.js';

const mockWithGitHubToken = vi.mocked(withGitHubToken);
const mockParseRepoFullName = vi.mocked(parseRepoFullName);

function makeResult(
	overrides: Partial<TriggerResult & { agentInput: Record<string, unknown> }> = {},
): TriggerResult {
	return {
		agentType: 'review',
		prNumber: 42,
		agentInput: {
			repoFullName: 'acme/myapp',
			headSha: 'abc123',
		},
		...overrides,
	} as TriggerResult;
}

describe('pollWaitForChecks', () => {
	beforeEach(async () => {
		mockParseRepoFullName.mockReturnValue({ owner: 'acme', repo: 'myapp' });
		mockWithGitHubToken.mockImplementation(
			(_token: string, fn: () => Promise<unknown>) => fn() as Promise<never>,
		);
	});

	it('returns true when all checks are passing', async () => {
		const { waitForChecks } = await import(
			'../../../../src/triggers/github/check-suite-success.js'
		);
		vi.mocked(waitForChecks).mockResolvedValue({
			totalCount: 2,
			allPassing: true,
			checkRuns: [
				{ name: 'lint', status: 'completed', conclusion: 'success' },
				{ name: 'test', status: 'completed', conclusion: 'success' },
			],
		});

		const result = makeResult();
		const passing = await pollWaitForChecks(result, 'acme/myapp', 'ghp_token');

		expect(passing).toBe(true);
	});

	it('returns false when some checks are failing', async () => {
		const { waitForChecks } = await import(
			'../../../../src/triggers/github/check-suite-success.js'
		);
		vi.mocked(waitForChecks).mockResolvedValue({
			totalCount: 2,
			allPassing: false,
			checkRuns: [
				{ name: 'lint', status: 'completed', conclusion: 'success' },
				{ name: 'test', status: 'completed', conclusion: 'failure' },
			],
		});

		const result = makeResult();
		const passing = await pollWaitForChecks(result, 'acme/myapp', 'ghp_token');

		expect(passing).toBe(false);
	});

	it('calls parseRepoFullName with the provided repoFullName', async () => {
		const { waitForChecks } = await import(
			'../../../../src/triggers/github/check-suite-success.js'
		);
		vi.mocked(waitForChecks).mockResolvedValue({
			totalCount: 1,
			allPassing: true,
			checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
		});

		const result = makeResult();
		await pollWaitForChecks(result, 'acme/myapp', 'ghp_token');

		expect(mockParseRepoFullName).toHaveBeenCalledWith('acme/myapp');
	});

	it('calls withGitHubToken with the provided token', async () => {
		const { waitForChecks } = await import(
			'../../../../src/triggers/github/check-suite-success.js'
		);
		vi.mocked(waitForChecks).mockResolvedValue({
			totalCount: 1,
			allPassing: true,
			checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
		});

		const result = makeResult();
		await pollWaitForChecks(result, 'acme/myapp', 'ghp_my_token');

		expect(mockWithGitHubToken).toHaveBeenCalledWith('ghp_my_token', expect.any(Function));
	});

	it('passes owner, repo, headSha, and prNumber to waitForChecks', async () => {
		const { waitForChecks } = await import(
			'../../../../src/triggers/github/check-suite-success.js'
		);
		const mockWaitForChecks = vi.mocked(waitForChecks);
		mockWaitForChecks.mockResolvedValue({
			totalCount: 1,
			allPassing: true,
			checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
		});

		const result = makeResult({
			prNumber: 99,
			agentInput: { repoFullName: 'acme/myapp', headSha: 'deadbeef' },
		} as Partial<TriggerResult>);

		await pollWaitForChecks(result, 'acme/myapp', 'ghp_token');

		expect(mockWaitForChecks).toHaveBeenCalledWith('acme', 'myapp', 'deadbeef', 99);
	});

	it('returns false and logs failed check names when some checks fail', async () => {
		const { waitForChecks } = await import(
			'../../../../src/triggers/github/check-suite-success.js'
		);
		vi.mocked(waitForChecks).mockResolvedValue({
			totalCount: 3,
			allPassing: false,
			checkRuns: [
				{ name: 'lint', status: 'completed', conclusion: 'success' },
				{ name: 'test', status: 'completed', conclusion: 'failure' },
				{ name: 'build', status: 'completed', conclusion: 'failure' },
			],
		});

		const { logger } = await import('../../../../src/utils/index.js');
		const result = makeResult();
		const passing = await pollWaitForChecks(result, 'acme/myapp', 'ghp_token');

		expect(passing).toBe(false);
		expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
			expect.stringContaining('Not all checks passing'),
			expect.objectContaining({
				failedChecks: expect.arrayContaining(['test', 'build']),
			}),
		);
	});

	it('uses prNumber 0 when result.prNumber is undefined', async () => {
		const { waitForChecks } = await import(
			'../../../../src/triggers/github/check-suite-success.js'
		);
		const mockWaitForChecks = vi.mocked(waitForChecks);
		mockWaitForChecks.mockResolvedValue({
			totalCount: 1,
			allPassing: true,
			checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
		});

		const result = makeResult({ prNumber: undefined });
		await pollWaitForChecks(result, 'acme/myapp', 'ghp_token');

		expect(mockWaitForChecks).toHaveBeenCalledWith('acme', 'myapp', 'abc123', 0);
	});
});
