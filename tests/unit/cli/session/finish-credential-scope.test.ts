/**
 * Regression net for cascade run `06ec8a0a` (Trello d1KVMufl, PR #1274): the agent
 * created the PR but the run was marked failed because `cascade-tools session finish`
 * extended raw oclif `Command` and skipped `CredentialScopedCommand.run()`'s
 * `withGitHubToken` scope. The fallback `findPRForCurrentBranch()` then hit
 * `getClient()` against empty AsyncLocalStorage, threw, got silently swallowed,
 * and reported "Cannot finish session without creating a PR" despite the PR existing.
 *
 * Critical: do NOT mock `src/github/client.js` here — that would short-circuit the
 * exact code path the bug lived in. Only mock at the `@octokit/rest` boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pullsList = vi.fn();
const octokitFactory = vi.fn(() => ({ pulls: { list: pullsList } }));
vi.mock('@octokit/rest', () => ({
	Octokit: vi.fn().mockImplementation((...args: unknown[]) => octokitFactory(...args)),
}));

const mockExecSync = vi.fn();
const mockExecFileSync = vi.fn();
vi.mock('node:child_process', () => ({
	execSync: (...args: unknown[]) => mockExecSync(...args),
	execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

// PM scope is irrelevant to this test — short-circuit it so we don't need to
// bootstrap the manifest registry. Other PM credential scopes are similarly
// unused: only GITHUB_TOKEN is set in env, so withTrello/Jira/Linear are no-ops.
vi.mock('../../../../src/pm/index.js', () => ({
	createPMProvider: vi.fn().mockReturnValue({}),
	withPMProvider: vi.fn((_p: unknown, fn: () => Promise<void>) => fn()),
}));

import FinishCommand from '../../../../src/cli/session/finish.js';

describe('session finish CLI — GitHub credential scope', () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
		process.env.CASCADE_FINISH_HOOKS = JSON.stringify({ requiresPR: true });
		process.env.GITHUB_TOKEN = 'ghp_test_token';
		process.env.CASCADE_AGENT_TYPE = 'implementation';
		delete process.env.CASCADE_PR_SIDECAR_PATH;
		delete process.env.CASCADE_REVIEW_SIDECAR_PATH;
		delete process.env.CASCADE_PUSHED_CHANGES_SIDECAR_PATH;
		delete process.env.CASCADE_PR_BRANCH;
		delete process.env.CASCADE_INITIAL_HEAD_SHA;

		mockExecSync.mockImplementation((cmd: string) => {
			if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'feature/trigger-enable-gate-helper\n';
			if (cmd === 'git remote get-url origin')
				return 'https://github.com/mongrel-intelligence/cascade.git\n';
			return '';
		});
		pullsList.mockReset();
	});

	afterEach(() => {
		process.env = originalEnv;
		// Note: do NOT call vi.restoreAllMocks() — it would also restore the
		// Octokit factory's mockImplementation set at module load, breaking the
		// next test in this file. mockReset() above on the per-test spies (and
		// resetting via beforeEach) is sufficient.
	});

	function buildCommand() {
		const cmd = new FinishCommand([], {} as never);
		cmd.log = vi.fn();
		cmd.exit = vi.fn((code?: number) => {
			throw new Error(`exit:${code}`);
		}) as never;
		cmd.parse = vi.fn().mockResolvedValue({
			flags: {
				comment: 'shipped',
				'pr-created': false,
				'review-submitted': false,
			},
			args: {},
			argv: [],
			raw: [],
			metadata: {},
			nonExistentFlags: {},
		} as never);
		return cmd;
	}

	it('succeeds when sidecar is absent but findPRForCurrentBranch resolves a PR via the scoped GitHub client', async () => {
		// Mocked Octokit returns one open PR — i.e. the agent did create the PR.
		pullsList.mockResolvedValue({
			data: [{ html_url: 'https://github.com/mongrel-intelligence/cascade/pull/1274' }],
		});

		const cmd = buildCommand();
		await cmd.run();

		expect(pullsList).toHaveBeenCalledWith({
			owner: 'mongrel-intelligence',
			repo: 'cascade',
			head: 'mongrel-intelligence:feature/trigger-enable-gate-helper',
			state: 'open',
			per_page: 1,
		});
		expect(cmd.log).toHaveBeenCalledWith(
			JSON.stringify({ success: true, data: 'Session ended: shipped' }),
		);
	});

	it('still fails (with the legitimate error) when sidecar is absent and the GitHub API returns no PR', async () => {
		pullsList.mockResolvedValue({ data: [] });

		const cmd = buildCommand();
		await expect(cmd.run()).rejects.toThrow('exit:1');

		expect(pullsList).toHaveBeenCalled();
		expect(cmd.log).toHaveBeenCalledWith(
			JSON.stringify({
				success: false,
				error:
					'Cannot finish session without creating a PR. ' +
					'You must call CreatePR to submit your changes before calling Finish.',
			}),
		);
	});
});
