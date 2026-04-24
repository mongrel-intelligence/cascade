import { githubClient } from '../../../github/client.js';
import { runCommand } from '../../../utils/repo.js';
import { buildRunLinkFooterFromEnv } from '../../../utils/runLink.js';

export interface CreatePRParams {
	title: string;
	body: string;
	head: string;
	base: string;
	draft?: boolean;
	commit?: boolean;
	commitMessage?: string;
	push?: boolean;
}

export interface CreatePRResult {
	prNumber: number;
	prUrl: string;
	repoFullName: string;
	alreadyExisted: boolean;
	/** Captured stdout+stderr from `git push` (including pre-push hook output). Spec 013. */
	pushOutput?: string;
	/** Captured stdout+stderr from `git commit` (including pre-commit hook output). Spec 013. */
	commitOutput?: string;
}

// Spec 013: per-caller timeouts for the two commands that trigger user-defined
// hooks. Values are sized to sit just under the gadget's 240s ceiling and to
// give test suites enough headroom for their slowest inter-event gaps.
const PUSH_WALL_TIMEOUT_MS = 230_000;
const PUSH_IDLE_TIMEOUT_MS = 90_000;
const COMMIT_WALL_TIMEOUT_MS = 120_000;
const COMMIT_IDLE_TIMEOUT_MS = 60_000;

async function detectOwnerRepo(): Promise<{ owner: string; repo: string }> {
	const result = await runCommand('git', ['remote', 'get-url', 'origin'], process.cwd());
	if (result.exitCode !== 0) {
		throw new Error('Failed to detect repository: no git remote "origin" found');
	}
	const match = result.stdout.trim().match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
	if (!match) {
		throw new Error(`Cannot parse owner/repo from git remote URL: ${result.stdout.trim()}`);
	}
	return { owner: match[1], repo: match[2] };
}

/**
 * Stage changes and commit. Returns the captured stdout+stderr of `git commit`
 * so callers can surface pre-commit hook output to operators. Empty string if
 * there was nothing to commit (early return after `git status`).
 */
async function stageAndCommit(commitMessage: string): Promise<string> {
	const addResult = await runCommand('git', ['add', '-u'], process.cwd());
	if (addResult.exitCode !== 0) {
		throw new Error(`Failed to stage changes: ${addResult.stderr || addResult.stdout}`.trim());
	}

	const untrackedResult = await runCommand(
		'git',
		['ls-files', '--others', '--exclude-standard'],
		process.cwd(),
	);
	if (untrackedResult.exitCode === 0 && untrackedResult.stdout.trim()) {
		const newFiles = untrackedResult.stdout.trim().split('\n');
		const addNewResult = await runCommand('git', ['add', '--', ...newFiles], process.cwd());
		if (addNewResult.exitCode !== 0) {
			throw new Error(
				`Failed to stage new files: ${addNewResult.stderr || addNewResult.stdout}`.trim(),
			);
		}
	}

	const statusResult = await runCommand('git', ['status', '--porcelain'], process.cwd());
	if (statusResult.stdout.trim() === '') {
		return '';
	}

	const commitResult = await runCommand(
		'git',
		['commit', '-m', commitMessage],
		process.cwd(),
		undefined,
		{
			label: 'git-commit',
			wallTimeoutMs: COMMIT_WALL_TIMEOUT_MS,
			idleTimeoutMs: COMMIT_IDLE_TIMEOUT_MS,
		},
	);
	if (commitResult.exitCode !== 0) {
		const output = [commitResult.stdout, commitResult.stderr].filter(Boolean).join('\n').trim();
		throw new Error(
			`COMMIT FAILED (pre-commit hooks may have failed)\n\n--- OUTPUT ---\n${output}`,
		);
	}
	return [commitResult.stdout, commitResult.stderr].filter(Boolean).join('\n').trim();
}

/**
 * Push the branch. Returns the captured stdout+stderr of `git push` so callers
 * can surface pre-push hook output (typecheck, tests, etc.) to operators.
 */
async function pushBranch(branch: string): Promise<string> {
	const pushResult = await runCommand(
		'git',
		['push', '-u', 'origin', branch],
		process.cwd(),
		undefined,
		{
			label: 'git-push',
			wallTimeoutMs: PUSH_WALL_TIMEOUT_MS,
			idleTimeoutMs: PUSH_IDLE_TIMEOUT_MS,
		},
	);
	if (pushResult.exitCode !== 0) {
		const output = [pushResult.stdout, pushResult.stderr].filter(Boolean).join('\n').trim();
		throw new Error(
			`PUSH FAILED for branch '${branch}' (pre-push hooks may have failed)\n\n--- OUTPUT ---\n${output}`,
		);
	}
	return [pushResult.stdout, pushResult.stderr].filter(Boolean).join('\n').trim();
}

async function verifyBranchOnRemote(branch: string): Promise<boolean> {
	const result = await runCommand('git', ['ls-remote', '--heads', 'origin', branch], process.cwd());
	return result.exitCode === 0 && result.stdout.trim().length > 0;
}

export async function createPR(params: CreatePRParams): Promise<CreatePRResult> {
	const { owner, repo } = await detectOwnerRepo();
	const commitMessage = params.commitMessage || params.title;

	let commitOutput: string | undefined;
	let pushOutput: string | undefined;

	if (params.commit !== false) {
		commitOutput = await stageAndCommit(commitMessage);
	}

	if (params.push !== false) {
		pushOutput = await pushBranch(params.head);
	}

	const branchExists = await verifyBranchOnRemote(params.head);
	if (!branchExists) {
		throw new Error(
			`Branch '${params.head}' does not exist on remote. Push the branch first or set push=true.`,
		);
	}

	const runLinkFooter = buildRunLinkFooterFromEnv();
	const prBody = runLinkFooter ? params.body + runLinkFooter : params.body;

	try {
		const pr = await githubClient.createPR(owner, repo, {
			title: params.title,
			body: prBody,
			head: params.head,
			base: params.base,
			draft: params.draft,
		});

		return {
			prNumber: pr.number,
			prUrl: pr.htmlUrl,
			repoFullName: `${owner}/${repo}`,
			alreadyExisted: false,
			pushOutput,
			commitOutput,
		};
	} catch (error) {
		if (
			error instanceof Error &&
			'status' in error &&
			error.status === 422 &&
			error.message.includes('A pull request already exists')
		) {
			const existingPR = await githubClient.getOpenPRByBranch(owner, repo, params.head);
			if (existingPR) {
				return {
					prNumber: existingPR.number,
					prUrl: existingPR.htmlUrl,
					repoFullName: `${owner}/${repo}`,
					alreadyExisted: true,
					pushOutput,
					commitOutput,
				};
			}
		}
		throw error;
	}
}
