import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listDirectory, writeFile } from '@llmist/cli/gadgets';
import { AgentBuilder, LLMist, createLogger } from 'llmist';

import { ReadFile } from '../gadgets/ReadFile.js';
import { Sleep } from '../gadgets/Sleep.js';
import { GetPRComments, GetPRDetails, ReplyToReviewComment } from '../gadgets/github/index.js';
import { Tmux } from '../gadgets/tmux.js';
import { githubClient } from '../github/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { type FileLogger, cleanupLogFile, createFileLogger } from '../utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../utils/lifecycle.js';
import { logger } from '../utils/logging.js';
import {
	cleanupTempDir,
	cloneRepo,
	createTempDir,
	runCommand as execCommand,
} from '../utils/repo.js';
import { getSystemPrompt } from './prompts/index.js';

interface ReviewAgentInput extends AgentInput {
	prNumber: number;
	prBranch: string;
	repoFullName: string;
	triggerCommentId: number;
	triggerCommentBody: string;
	triggerCommentPath: string;
	triggerCommentUrl: string;
	project: ProjectConfig;
	config: CascadeConfig;
}

// ============================================================================
// Log Level Configuration
// ============================================================================

const LOG_LEVELS: Record<string, number> = {
	trace: 0,
	debug: 1,
	info: 2,
	warn: 3,
	error: 4,
};

function getLogLevel(): number {
	const level = process.env.LLMIST_LOG_LEVEL?.toLowerCase() || 'info';
	return LOG_LEVELS[level] ?? 2;
}

// ============================================================================
// Directory Listing Utility
// ============================================================================

async function generateDirectoryListing(cwd: string, depth: number): Promise<string> {
	try {
		const result = await execCommand(
			'find',
			['.', '-maxdepth', String(depth), '-type', 'f', '-o', '-type', 'd'],
			cwd,
		);
		return result.stdout;
	} catch {
		return '';
	}
}

// ============================================================================
// Context Files (CLAUDE.md, AGENTS.md)
// ============================================================================

interface ContextFile {
	path: string;
	content: string;
}

async function readContextFiles(cwd: string): Promise<ContextFile[]> {
	const files = ['CLAUDE.md', 'AGENTS.md'];
	const results: ContextFile[] = [];

	for (const file of files) {
		try {
			const result = await execCommand('cat', [file], cwd);
			if (result.stdout.trim()) {
				results.push({ path: file, content: result.stdout.trim() });
			}
		} catch {
			// File doesn't exist, skip
		}
	}

	return results;
}

// ============================================================================
// Dependency Installation
// ============================================================================

interface DependencyInstallResult {
	packageManager: string;
	success: boolean;
	output: string;
	error?: string;
}

async function installDependencies(cwd: string): Promise<DependencyInstallResult | null> {
	const packageJsonPath = join(cwd, 'package.json');
	if (!existsSync(packageJsonPath)) {
		return null;
	}

	const lockfiles = [
		{ file: 'bun.lockb', pm: 'bun' },
		{ file: 'pnpm-lock.yaml', pm: 'pnpm' },
		{ file: 'yarn.lock', pm: 'yarn' },
		{ file: 'package-lock.json', pm: 'npm' },
	];

	let packageManager = 'npm';

	for (const { file, pm } of lockfiles) {
		if (existsSync(join(cwd, file))) {
			packageManager = pm;
			break;
		}
	}

	if (packageManager === 'npm') {
		try {
			const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
			if (pkg.packageManager) {
				const match = pkg.packageManager.match(/^(npm|yarn|pnpm|bun)@/);
				if (match) {
					packageManager = match[1];
				}
			}
		} catch {
			// Ignore parse errors
		}
	}

	try {
		const result = await execCommand(packageManager, ['install'], cwd, {
			CI: 'true',
			PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
		});
		return {
			packageManager,
			success: true,
			output: result.stdout + result.stderr,
		};
	} catch (err) {
		return {
			packageManager,
			success: false,
			output: '',
			error: String(err),
		};
	}
}

// ============================================================================
// Review Agent Execution
// ============================================================================

export async function executeReviewAgent(input: ReviewAgentInput): Promise<AgentResult> {
	const { project, config, prNumber, prBranch, repoFullName } = input;

	// Parse owner/repo from repoFullName
	const [owner, repo] = repoFullName.split('/');
	if (!owner || !repo) {
		return { success: false, output: '', error: `Invalid repo format: ${repoFullName}` };
	}

	let repoDir: string | null = null;
	let fileLogger: FileLogger | null = null;

	fileLogger = createFileLogger(`cascade-review-${prNumber}`);

	setWatchdogCleanup(async () => {
		if (fileLogger) {
			fileLogger.close();
			// For review agent, we post a comment to the PR instead of attaching logs to Trello
			await githubClient.createPRComment(
				owner,
				repo,
				prNumber,
				'⚠️ Review agent timed out while addressing feedback.',
			);
			logger.info('Posted timeout notice to PR', { prNumber });
		}
	});

	const log = {
		debug: (msg: string, ctx?: Record<string, unknown>) => {
			logger.debug(msg, ctx);
			fileLogger?.write('DEBUG', msg, ctx);
		},
		info: (msg: string, ctx?: Record<string, unknown>) => {
			logger.info(msg, ctx);
			fileLogger?.write('INFO', msg, ctx);
		},
		warn: (msg: string, ctx?: Record<string, unknown>) => {
			logger.warn(msg, ctx);
			fileLogger?.write('WARN', msg, ctx);
		},
		error: (msg: string, ctx?: Record<string, unknown>) => {
			logger.error(msg, ctx);
			fileLogger?.write('ERROR', msg, ctx);
		},
	};

	try {
		// Clone repo to temp directory
		repoDir = createTempDir(project.id);
		cloneRepo(project, repoDir);

		// Checkout the PR branch
		log.info('Checking out PR branch', { prBranch });
		await execCommand('git', ['checkout', prBranch], repoDir);

		// Install dependencies
		log.info('Checking for dependencies to install', { repoDir });
		const installResult = await installDependencies(repoDir);
		if (installResult) {
			log.info('Dependencies installed', {
				packageManager: installResult.packageManager,
				success: installResult.success,
			});
		}

		log.info('Running review agent', { prNumber, repoFullName, repoDir });

		// Get system prompt
		const systemPrompt = project.prompts?.review || getSystemPrompt('review', {});
		const model = project.agentModels?.review || project.model || config.defaults.model;
		const maxIterations = config.defaults.maxIterations;

		// Read context files
		const contextFiles = await readContextFiles(repoDir);

		// Fetch PR details and comments
		log.info('Fetching PR details and comments', { owner, repo, prNumber });
		const prDetails = await githubClient.getPR(owner, repo, prNumber);
		const prComments = await githubClient.getPRReviewComments(owner, repo, prNumber);

		// Format PR details for agent context
		const prDetailsFormatted = [
			`PR #${prDetails.number}: ${prDetails.title}`,
			`State: ${prDetails.state}`,
			`Branch: ${prDetails.headRef} -> ${prDetails.baseRef}`,
			`URL: ${prDetails.htmlUrl}`,
			'',
			'Description:',
			prDetails.body || '(no description)',
		].join('\n');

		// Format comments for agent context
		const commentsFormatted =
			prComments.length === 0
				? 'No review comments found.'
				: prComments
						.map((c) =>
							[
								`Comment #${c.id} by @${c.user.login}`,
								`File: ${c.path}${c.line ? `:${c.line}` : ''}`,
								`URL: ${c.htmlUrl}`,
								c.inReplyToId ? `In reply to: #${c.inReplyToId}` : null,
								'',
								c.body,
								'---',
							]
								.filter(Boolean)
								.join('\n'),
						)
						.join('\n\n');

		// Generate directory listing
		const directoryListing = await generateDirectoryListing(repoDir, 3);
		const directorySection = directoryListing
			? `Here is the codebase directory structure:

<codebase_structure>
${directoryListing}
</codebase_structure>

`
			: '';

		const prompt = `${directorySection}You are on the branch \`${prBranch}\` for PR #${prNumber}.

Address the review comments and push your changes.

## GitHub Context

Owner: ${owner}
Repo: ${repo}
PR Number: ${prNumber}

Use these values when calling GitHub gadgets (GetPRComments, ReplyToReviewComment).`;

		// Change to repo directory
		const originalCwd = process.cwd();
		process.chdir(repoDir);

		log.info('Starting llmist agent', { model, maxIterations, promptLength: prompt.length });

		try {
			process.env.LLMIST_LOG_FILE = fileLogger.llmistLogPath;

			const client = new LLMist();
			const llmistLogger = createLogger({ minLevel: getLogLevel() });

			let builder = new AgentBuilder(client)
				.withModel(model)
				.withSystem(systemPrompt)
				.withMaxIterations(maxIterations)
				.withLogger(llmistLogger)
				.withGadgets(
					// Filesystem gadgets
					listDirectory,
					new ReadFile(),
					writeFile,
					// Shell commands via tmux
					new Tmux(),
					new Sleep(),
					// GitHub gadgets
					new GetPRDetails(),
					new GetPRComments(),
					new ReplyToReviewComment(),
				);

			// Inject PR details as synthetic GetPRDetails call
			builder = builder.withSyntheticGadgetCall(
				'GetPRDetails',
				{ owner, repo, prNumber },
				prDetailsFormatted,
				'gc_pr_details',
			);

			// Inject PR comments as synthetic GetPRComments call
			builder = builder.withSyntheticGadgetCall(
				'GetPRComments',
				{ owner, repo, prNumber },
				commentsFormatted,
				'gc_pr_comments',
			);

			// Inject context files
			for (let i = 0; i < contextFiles.length; i++) {
				const file = contextFiles[i];
				builder = builder.withSyntheticGadgetCall(
					'ReadFile',
					{ filePath: file.path },
					file.content,
					`gc_init_${i + 1}`,
				);
			}

			// Inject dependency install result
			if (installResult) {
				const installOutput = installResult.success
					? `✓ Dependencies installed with ${installResult.packageManager}\n\n${installResult.output}`
					: `✗ Dependency install failed (${installResult.packageManager})\n\nError: ${installResult.error}`;

				builder = builder.withSyntheticGadgetCall(
					'Tmux',
					{
						action: 'start',
						session: 'deps-install',
						command: `${installResult.packageManager} install`,
					},
					installOutput,
					'gc_deps',
				);
			}

			// Run the agent
			const agent = builder.ask(prompt);
			const outputLines: string[] = [];
			let iterationCount = 0;

			for await (const event of agent.run()) {
				if (event.type === 'text') {
					log.debug('[Text]', { content: event.content.slice(0, 100) });
					outputLines.push(event.content);
				} else if (event.type === 'gadget_call') {
					iterationCount++;
					log.info('[Gadget]', {
						iteration: iterationCount,
						name: event.call.gadgetName,
						invocationId: event.call.invocationId,
					});
				} else if (event.type === 'gadget_result') {
					const level = event.result.error ? 'error' : 'info';
					log[level]('[Gadget result]', {
						name: event.result.gadgetName,
						ms: event.result.executionTimeMs,
						error: event.result.error,
					});
				} else if (event.type === 'stream_complete') {
					log.info('Stream complete', { iteration: iterationCount });
				}
			}

			const sessionCost = agent.getTree()?.getTotalCost() ?? 0;

			log.info('Review agent completed', {
				prNumber,
				iterations: iterationCount,
				cost: sessionCost,
			});

			fileLogger.close();
			const logBuffer = await fileLogger.getZippedBuffer();

			return {
				success: true,
				output: outputLines.join('\n'),
				logBuffer,
				cost: sessionCost,
			};
		} finally {
			process.chdir(originalCwd);
		}
	} catch (err) {
		logger.error('Review agent execution failed', { prNumber, error: String(err) });

		let logBuffer: Buffer | undefined;
		if (fileLogger) {
			try {
				fileLogger.close();
				logBuffer = await fileLogger.getZippedBuffer();
			} catch {
				// Ignore log buffer errors
			}
		}

		return {
			success: false,
			output: '',
			error: String(err),
			logBuffer,
		};
	} finally {
		clearWatchdogCleanup();

		if (repoDir) {
			try {
				cleanupTempDir(repoDir);
			} catch (err) {
				logger.warn('Failed to cleanup temp directory', { repoDir, error: String(err) });
			}
		}
		if (fileLogger) {
			cleanupLogFile(fileLogger.logPath);
			cleanupLogFile(fileLogger.llmistLogPath);
		}
	}
}
