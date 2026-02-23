import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { getProjectGitHubToken } from '../config/projects.js';
import type { ProjectConfig } from '../types/index.js';
import { logger } from './logging.js';

/**
 * Parse a GitHub "owner/repo" full name string into its components.
 * Throws if the format is malformed.
 */
export function parseRepoFullName(fullName: string): { owner: string; repo: string } {
	const slashIdx = fullName.indexOf('/');
	if (slashIdx <= 0 || slashIdx === fullName.length - 1) {
		throw new Error(`Invalid repository full name: "${fullName}". Expected "owner/repo" format.`);
	}
	const owner = fullName.slice(0, slashIdx);
	const repo = fullName.slice(slashIdx + 1);
	return { owner, repo };
}

/**
 * Get the base directory for temporary files (repos, logs).
 * Uses CASCADE_WORKSPACE_DIR env var if set, otherwise /workspace.
 */
export function getWorkspaceDir(): string {
	return process.env.CASCADE_WORKSPACE_DIR || '/workspace';
}

export function createTempDir(projectId: string): string {
	const baseDir = getWorkspaceDir();
	const tempDir = `${baseDir}/cascade-${projectId}-${Date.now()}`;
	mkdirSync(tempDir, { recursive: true });
	return tempDir;
}

export async function cloneRepo(
	project: ProjectConfig,
	targetDir: string,
	token?: string,
): Promise<void> {
	const cloneToken = token ?? (await getProjectGitHubToken(project));
	const cloneUrl = `https://${cloneToken}@github.com/${project.repo}.git`;

	const branch = project.baseBranch ?? 'main';
	logger.info('Cloning repository', { repo: project.repo, targetDir, branch });

	execSync(`git clone --branch ${branch} ${cloneUrl} ${targetDir}`, {
		stdio: 'pipe',
		env: { ...process.env },
	});

	// Configure git user for commits
	execSync('git config user.name "Cascade Bot"', { cwd: targetDir, stdio: 'pipe' });
	execSync('git config user.email "bot@cascade.dev"', { cwd: targetDir, stdio: 'pipe' });

	logger.info('Repository cloned and configured');
}

export function cleanupTempDir(dir: string): void {
	const workspaceDir = getWorkspaceDir();
	if (existsSync(dir) && dir.startsWith(`${workspaceDir}/cascade-`)) {
		logger.debug('Cleaning up temp directory', { dir });
		rmSync(dir, { recursive: true, force: true });
	}
}

export async function runCommand(
	command: string,
	args: string[],
	cwd: string,
	env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			cwd,
			env: { ...process.env, ...env },
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (data) => {
			stdout += data.toString();
		});

		child.stderr.on('data', (data) => {
			stderr += data.toString();
		});

		child.on('close', (code) => {
			resolve({ stdout, stderr, exitCode: code ?? 1 });
		});

		child.on('error', (err) => {
			stderr += err.message;
			resolve({ stdout, stderr, exitCode: 1 });
		});
	});
}
