import { githubClient } from '../../../github/client.js';
import { runCommand } from '../../../utils/repo.js';
import { buildRunLink, buildWorkItemRunsLink, getDashboardUrl } from '../../../utils/runLink.js';

/**
 * Build the run link footer for PR body, reading env vars injected
 * by the secretBuilder for subprocess agents (claude-code/codex/opencode).
 */
function buildRunLinkFooter(): string {
	if (process.env.CASCADE_RUN_LINKS_ENABLED !== 'true') return '';
	const dashboardUrl = getDashboardUrl();
	if (!dashboardUrl) return '';

	const runId = process.env.CASCADE_RUN_ID;
	const engineLabel = process.env.CASCADE_ENGINE_LABEL ?? '';
	const model = process.env.CASCADE_MODEL ?? '';
	const projectId = process.env.CASCADE_PROJECT_ID ?? '';
	const workItemId = process.env.CASCADE_WORK_ITEM_ID ?? '';

	if (runId) {
		return buildRunLink({ dashboardUrl, runId, engineLabel, model });
	}
	if (projectId && workItemId) {
		return buildWorkItemRunsLink({ dashboardUrl, projectId, workItemId, engineLabel, model });
	}
	return '';
}

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
}

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

async function stageAndCommit(commitMessage: string): Promise<void> {
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
		return;
	}

	const commitResult = await runCommand('git', ['commit', '-m', commitMessage], process.cwd());
	if (commitResult.exitCode !== 0) {
		const output = [commitResult.stdout, commitResult.stderr].filter(Boolean).join('\n').trim();
		throw new Error(
			`COMMIT FAILED (pre-commit hooks may have failed)\n\n--- OUTPUT ---\n${output}`,
		);
	}
}

async function pushBranch(branch: string): Promise<void> {
	const pushResult = await runCommand('git', ['push', '-u', 'origin', branch], process.cwd());
	if (pushResult.exitCode !== 0) {
		const output = [pushResult.stdout, pushResult.stderr].filter(Boolean).join('\n').trim();
		throw new Error(
			`PUSH FAILED for branch '${branch}' (pre-push hooks may have failed)\n\n--- OUTPUT ---\n${output}`,
		);
	}
}

async function verifyBranchOnRemote(branch: string): Promise<boolean> {
	const result = await runCommand('git', ['ls-remote', '--heads', 'origin', branch], process.cwd());
	return result.exitCode === 0 && result.stdout.trim().length > 0;
}

export async function createPR(params: CreatePRParams): Promise<CreatePRResult> {
	const { owner, repo } = await detectOwnerRepo();
	const commitMessage = params.commitMessage || params.title;

	if (params.commit !== false) {
		await stageAndCommit(commitMessage);
	}

	if (params.push !== false) {
		await pushBranch(params.head);
	}

	const branchExists = await verifyBranchOnRemote(params.head);
	if (!branchExists) {
		throw new Error(
			`Branch '${params.head}' does not exist on remote. Push the branch first or set push=true.`,
		);
	}

	const runLinkFooter = buildRunLinkFooter();
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
				};
			}
		}
		throw error;
	}
}
