import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ProjectConfig } from '../../types/index.js';
import { cloneRepo, createTempDir, runCommand } from '../../utils/repo.js';
import type { AgentLogger } from '../utils/logging.js';
import { warmTypeScriptCache } from '../utils/setup.js';

export interface SetupRepositoryOptions {
	project: ProjectConfig;
	log: AgentLogger;
	agentType: string;
	prBranch?: string;
	warmTsCache?: boolean;
}

export async function setupRepository(options: SetupRepositoryOptions): Promise<string> {
	const { project, log, agentType, prBranch, warmTsCache } = options;

	// Create temp directory for all agents
	const repoDir = createTempDir(project.id);

	// Skip cloning if no repo is configured
	if (!project.repo) {
		log.info('No repo configured, skipping clone', { projectId: project.id, agentType });
		return repoDir;
	}

	// Clone repo to temp directory
	await cloneRepo(project, repoDir);

	// Checkout PR branch if provided
	if (prBranch) {
		log.info('Checking out PR branch', { prBranch });
		await runCommand('git', ['checkout', prBranch], repoDir);
	}

	// Run project-specific setup script if it exists (handles dependency installation)
	const setupScriptPath = join(repoDir, '.cascade', 'setup.sh');
	if (existsSync(setupScriptPath)) {
		log.info('Running project setup script', { path: '.cascade/setup.sh', agentType });
		const setupResult = await runCommand('bash', [setupScriptPath], repoDir, {
			AGENT_PROFILE_NAME: agentType,
		});
		log.info('Setup script completed', {
			exitCode: setupResult.exitCode,
			stdout: setupResult.stdout.slice(-500),
			stderr: setupResult.stderr.slice(-500),
		});
		if (setupResult.exitCode !== 0) {
			log.warn('Setup script exited with non-zero code', { exitCode: setupResult.exitCode });
		}
	}

	// Warm TypeScript cache to avoid slow first-run compilation during agent execution
	if (warmTsCache) {
		log.info('Warming TypeScript cache', { repoDir });
		const tscResult = await warmTypeScriptCache(repoDir);
		if (tscResult) {
			log.info('TypeScript cache warmed', {
				durationMs: tscResult.durationMs,
				hadErrors: !!tscResult.error,
			});
		}
	}

	return repoDir;
}
