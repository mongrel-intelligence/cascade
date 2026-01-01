import { listDirectory, writeFile } from '@llmist/cli/gadgets';
import { AgentBuilder, LLMist, createLogger } from 'llmist';

import { ReadFile } from '../gadgets/ReadFile.js';
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
import { cleanupLogFile, createFileLogger } from '../utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../utils/lifecycle.js';
import { logger } from '../utils/logging.js';
import { cleanupTempDir, cloneRepo, createTempDir } from '../utils/repo.js';
import { type PromptContext, getSystemPrompt } from './prompts/index.js';
import {
	type DependencyInstallResult,
	generateDirectoryListing,
	getLogLevel,
	installDependencies,
	readContextFiles,
	warmTypeScriptCache,
} from './utils/index.js';
import { createAgentLogger } from './utils/logging.js';

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

	// Create file logger for this agent run
	const fileLogger = createFileLogger(`cascade-${agentType}-${cardId}`);
	const log = createAgentLogger(fileLogger);

	// Register cleanup callback for watchdog timeout (upload logs before force exit)
	setWatchdogCleanup(async () => {
		fileLogger.close();
		const logBuffer = await fileLogger.getZippedBuffer();
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const logName = `${agentType}-timeout-${timestamp}.zip`;
		await trelloClient.addAttachmentFile(cardId, logBuffer, logName);
		logger.info('Uploaded timeout log to card', { cardId, logName });
	});

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

		// Warm TypeScript cache to avoid slow first-run compilation during agent execution
		log.info('Warming TypeScript cache', { repoDir });
		const tscResult = await warmTypeScriptCache(repoDir);
		if (tscResult) {
			log.info('TypeScript cache warmed', {
				durationMs: tscResult.durationMs,
				hadErrors: !!tscResult.error,
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
		const model =
			project.agentModels?.[agentType] ||
			project.model ||
			config.defaults.agentModels?.[agentType] ||
			config.defaults.model;
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
				.withTemperature(0)
				.withSystem(systemPrompt)
				.withMaxIterations(maxIterations)
				.withLogger(llmistLogger)
				.withGadgets(
					// Filesystem gadgets
					listDirectory,
					new ReadFile(),
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
				builder = injectDependencyResult(builder, installResult);
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
