import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { getProjectGitHubToken } from '../config/projects.js';
import type { ProjectConfig } from '../types/index.js';
import { logger } from './logging.js';

export function createTempDir(projectId: string): string {
	const tempDir = `/tmp/cascade-${projectId}-${Date.now()}`;
	mkdirSync(tempDir, { recursive: true });
	return tempDir;
}

export function cloneRepo(project: ProjectConfig, targetDir: string): void {
	const token = getProjectGitHubToken(project);
	const cloneUrl = `https://${token}@github.com/${project.repo}.git`;

	logger.info('Cloning repository', { repo: project.repo, targetDir });

	execSync(`git clone ${cloneUrl} ${targetDir}`, {
		stdio: 'pipe',
		env: { ...process.env },
	});

	// Configure git user for commits
	execSync('git config user.name "Cascade Bot"', { cwd: targetDir, stdio: 'pipe' });
	execSync('git config user.email "bot@cascade.dev"', { cwd: targetDir, stdio: 'pipe' });

	logger.info('Repository cloned and configured');
}

export function cleanupTempDir(dir: string): void {
	if (existsSync(dir) && dir.startsWith('/tmp/cascade-')) {
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
