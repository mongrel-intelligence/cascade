import { listDirectory, writeFile } from '@llmist/cli/gadgets';
import { AgentBuilder, LLMist, createLogger } from 'llmist';

import { ReadFile } from '../gadgets/ReadFile.js';
import { Sleep } from '../gadgets/Sleep.js';
import { GetPRComments, GetPRDetails, ReplyToReviewComment } from '../gadgets/github/index.js';
import { Tmux } from '../gadgets/tmux.js';
import { githubClient } from '../github/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { cleanupLogFile, createFileLogger } from '../utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../utils/lifecycle.js';
import { logger } from '../utils/logging.js';
import {
	cleanupTempDir,
	cloneRepo,
	createTempDir,
	runCommand as execCommand,
} from '../utils/repo.js';
import { getSystemPrompt } from './prompts/index.js';
import {
	type DependencyInstallResult,
	generateDirectoryListing,
	getLogLevel,
	installDependencies,
	readContextFiles,
} from './utils/index.js';
import { createAgentLogger } from './utils/logging.js';

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

	// Create file logger for this agent run
	const fileLogger = createFileLogger(`cascade-review-${prNumber}`);
	const log = createAgentLogger(fileLogger);

	// Register cleanup callback for watchdog timeout
	setWatchdogCleanup(async () => {
		fileLogger.close();
		// For review agent, we post a comment to the PR instead of attaching logs to Trello
		await githubClient.createPRComment(
			owner,
			repo,
			prNumber,
			'⚠️ Review agent timed out while addressing feedback.',
		);
		logger.info('Posted timeout notice to PR', { prNumber });
	});

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
		const model =
			project.agentModels?.review ||
			project.model ||
			config.defaults.agentModels?.review ||
			config.defaults.model;
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
				.withTemperature(0)
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
				builder = injectDependencyResult(builder, installResult);
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
		try {
			fileLogger.close();
			logBuffer = await fileLogger.getZippedBuffer();
		} catch {
			// Ignore log buffer errors
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
		cleanupLogFile(fileLogger.logPath);
		cleanupLogFile(fileLogger.llmistLogPath);
	}
}

// ============================================================================
// Helpers
// ============================================================================

function injectDependencyResult(
	builder: ReturnType<typeof AgentBuilder.prototype.withGadgets>,
	installResult: DependencyInstallResult,
): ReturnType<typeof AgentBuilder.prototype.withGadgets> {
	const installOutput = installResult.success
		? `✓ Dependencies installed with ${installResult.packageManager}\n\n${installResult.output}`
		: `✗ Dependency install failed (${installResult.packageManager})\n\nError: ${installResult.error}`;

	return builder.withSyntheticGadgetCall(
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
