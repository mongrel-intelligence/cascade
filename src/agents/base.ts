import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listDirectory, readFile, writeFile } from '@llmist/cli/gadgets';
import { AgentBuilder, LLMist, createLogger } from 'llmist';

import { Sleep } from '../gadgets/Sleep.js';
import { Tmux } from '../gadgets/tmux.js';
import {
	AddChecklistToCard,
	CreateTrelloCard,
	GetMyRecentActivity,
	ListTrelloCards,
	PostTrelloComment,
	ReadTrelloCard,
	UpdateTrelloCard,
	formatCardData,
} from '../gadgets/trello/index.js';
import { trelloClient } from '../trello/client.js';
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
import { type PromptContext, getSystemPrompt } from './prompts/index.js';

export interface AgentContext {
	project: ProjectConfig;
	config: CascadeConfig;
	cardId: string;
	repoDir: string;
}

export interface AgentRunner {
	name: string;
	run: (ctx: AgentContext) => Promise<AgentResult>;
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
	const level = process.env.LOG_LEVEL?.toLowerCase() || 'info';
	return LOG_LEVELS[level] ?? 2; // default to info
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
	// Check if package.json exists
	const packageJsonPath = join(cwd, 'package.json');
	if (!existsSync(packageJsonPath)) {
		return null; // No package.json, skip
	}

	// Detect package manager from lockfiles (priority order)
	const lockfiles = [
		{ file: 'bun.lockb', pm: 'bun' },
		{ file: 'pnpm-lock.yaml', pm: 'pnpm' },
		{ file: 'yarn.lock', pm: 'yarn' },
		{ file: 'package-lock.json', pm: 'npm' },
	];

	let packageManager = 'npm'; // default

	for (const { file, pm } of lockfiles) {
		if (existsSync(join(cwd, file))) {
			packageManager = pm;
			break;
		}
	}

	// Check packageManager field in package.json as fallback
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

	// Run install command
	try {
		const result = await execCommand(packageManager, ['install'], cwd);
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
// Agent Execution
// ============================================================================

export async function executeAgent(
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
): Promise<AgentResult> {
	const { project, config, cardId } = input;

	if (!cardId) {
		return { success: false, output: '', error: 'No card ID provided' };
	}

	let repoDir: string | null = null;
	let fileLogger: FileLogger | null = null;

	// Create file logger for this agent run
	fileLogger = createFileLogger(`cascade-${agentType}-${cardId}`);

	// Register cleanup callback for watchdog timeout (upload logs before force exit)
	setWatchdogCleanup(async () => {
		if (fileLogger) {
			fileLogger.close();
			const logBuffer = await fileLogger.getZippedBuffer();
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const logName = `${agentType}-timeout-${timestamp}.zip`;
			await trelloClient.addAttachmentFile(cardId, logBuffer, logName);
			logger.info('Uploaded timeout log to card', { cardId, logName });
		}
	});

	// Helper to log to both console and file
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

		// Install dependencies if package.json exists
		log.info('Checking for dependencies to install', { repoDir });
		const installResult = await installDependencies(repoDir);
		if (installResult) {
			log.info('Dependencies installed', {
				packageManager: installResult.packageManager,
				success: installResult.success,
			});
		}

		log.info('Running agent', { agentType, cardId, repoDir });

		// Build prompt context for template rendering
		const promptContext: PromptContext = {
			cardId,
			projectId: project.id,
			storiesListId: project.trello?.lists?.stories,
			processedLabelId: project.trello?.labels?.processed,
		};

		// Get system prompt and model
		const systemPrompt = project.prompts?.[agentType] || getSystemPrompt(agentType, promptContext);
		const model = project.agentModels?.[agentType] || project.model || config.defaults.model;
		const maxIterations = config.defaults.maxIterations;

		// Read context files (CLAUDE.md, AGENTS.md) for synthetic gadget calls
		const contextFiles = await readContextFiles(repoDir);

		// Pre-fetch card data for synthetic gadget call
		log.info('Fetching card data for context', { cardId });
		const cardData = await formatCardData(cardId, true);

		// Generate directory listing for codebase context
		const directoryListing = await generateDirectoryListing(repoDir, 3);
		const directorySection = directoryListing
			? `Here is the codebase directory structure (pre-populated for context):

<codebase_structure>
${directoryListing}
</codebase_structure>

`
			: '';

		const prompt = `${directorySection}Analyze and process the Trello card with ID: ${cardId}. The card data (title, description, checklists, attachments, comments) has been pre-loaded above. Review it and proceed with your task.`;

		// Change to repo directory (llmist gadgets use process.cwd() for path validation)
		const originalCwd = process.cwd();
		process.chdir(repoDir);

		log.info('Starting llmist agent', { model, maxIterations, promptLength: prompt.length });

		try {
			// Configure llmist to write to separate log file for better debugging
			process.env.LLMIST_LOG_FILE = fileLogger.llmistLogPath;

			// Create llmist client and logger
			const client = new LLMist();
			const llmistLogger = createLogger({ minLevel: getLogLevel() });

			// Build the agent
			let builder = new AgentBuilder(client)
				.withModel(model)
				.withSystem(systemPrompt)
				.withMaxIterations(maxIterations)
				.withLogger(llmistLogger)
				.withGadgets(
					// Filesystem gadgets from @llmist/cli (sandboxed to process.cwd())
					listDirectory,
					readFile,
					writeFile,
					// Shell commands via tmux (no timeout issues)
					new Tmux(),
					new Sleep(),
					// Trello gadgets
					new ReadTrelloCard(),
					new PostTrelloComment(),
					new UpdateTrelloCard(),
					new CreateTrelloCard(),
					new ListTrelloCards(),
					new GetMyRecentActivity(),
					new AddChecklistToCard(),
				);

			// Inject card data as synthetic ReadTrelloCard call
			builder = builder.withSyntheticGadgetCall(
				'ReadTrelloCard',
				{ cardId, includeComments: true },
				cardData,
				'gc_card',
			);

			// Inject context files as synthetic ReadFile gadget calls
			for (let i = 0; i < contextFiles.length; i++) {
				const file = contextFiles[i];
				builder = builder.withSyntheticGadgetCall(
					'ReadFile',
					{ filePath: file.path },
					file.content,
					`gc_init_${i + 1}`,
				);
			}

			// Inject dependency install result as synthetic Tmux call
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

			// Collect output
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

			// Get cost from llmist execution tree
			const sessionCost = agent.getTree()?.getTotalCost() ?? 0;

			log.info('Agent completed', { cardId, iterations: iterationCount, cost: sessionCost });

			// Get zipped log buffer before returning
			fileLogger.close();
			const logBuffer = await fileLogger.getZippedBuffer();

			return {
				success: true,
				output: outputLines.join('\n'),
				logBuffer,
				cost: sessionCost,
			};
		} finally {
			// Restore original working directory
			process.chdir(originalCwd);
		}
	} catch (err) {
		logger.error('Agent execution failed', { agentType, error: String(err) });

		// Get zipped log buffer before returning (if logger exists)
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
		// Clear watchdog cleanup callback (no longer needed)
		clearWatchdogCleanup();

		// Cleanup temp directory
		if (repoDir) {
			try {
				cleanupTempDir(repoDir);
			} catch (err) {
				logger.warn('Failed to cleanup temp directory', { repoDir, error: String(err) });
			}
		}
		// Cleanup log files (buffer already extracted)
		if (fileLogger) {
			cleanupLogFile(fileLogger.logPath);
			cleanupLogFile(fileLogger.llmistLogPath);
		}
	}
}
