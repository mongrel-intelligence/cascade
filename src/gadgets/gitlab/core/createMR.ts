import { gitlabClient } from '../../../gitlab/client.js';
import { runCommand } from '../../../utils/repo.js';
import { buildRunLinkFooterFromEnv } from '../../../utils/runLink.js';

export interface CreateMRFullParams {
	title: string;
	body: string;
	head: string;
	base: string;
	draft?: boolean;
	commit?: boolean;
	commitMessage?: string;
	push?: boolean;
}

export interface CreateMRResult {
	mrIid: number;
	mrUrl: string;
	projectPath: string;
	alreadyExisted: boolean;
}

async function detectProjectPath(): Promise<string> {
	const result = await runCommand('git', ['remote', 'get-url', 'origin'], process.cwd());
	if (result.exitCode !== 0) {
		throw new Error('Failed to detect repository: no git remote "origin" found');
	}
	const url = result.stdout.trim();
	// Match gitlab.com (or self-hosted) paths: git@gitlab.com:group/repo.git or https://...@gitlab.com/group/repo.git
	// SSH: git@host:group/repo.git
	const sshMatch = url.match(/@[^:]+:(.+?)(?:\.git)?$/);
	if (sshMatch) return sshMatch[1];
	// HTTPS: https://oauth2:token@host/group/repo.git
	const httpsMatch = url.match(/https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
	if (httpsMatch) return httpsMatch[1];
	throw new Error(`Cannot parse project path from git remote URL: ${url}`);
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

export async function createMR(params: CreateMRFullParams): Promise<CreateMRResult> {
	const projectPath = await detectProjectPath();
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

	const runLinkFooter = buildRunLinkFooterFromEnv();
	const mrBody = runLinkFooter ? params.body + runLinkFooter : params.body;

	// Check if an MR already exists for this branch
	const existingMR = await gitlabClient.getOpenMRByBranch(projectPath, params.head);
	if (existingMR) {
		return {
			mrIid: existingMR.iid,
			mrUrl: existingMR.webUrl,
			projectPath,
			alreadyExisted: true,
		};
	}

	const mr = await gitlabClient.createMR(projectPath, {
		title: params.title,
		description: mrBody,
		sourceBranch: params.head,
		targetBranch: params.base,
		draft: params.draft,
	});

	return {
		mrIid: mr.iid,
		mrUrl: mr.webUrl,
		projectPath,
		alreadyExisted: false,
	};
}
