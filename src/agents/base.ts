import { listDirectory, readFile, runCommand } from '@llmist/cli/gadgets';
import { AgentBuilder, LLMist, createLogger } from 'llmist';

import { PostTrelloComment, ReadTrelloCard, UpdateTrelloCard } from '../gadgets/trello/index.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import {
	cleanupTempDir,
	cloneRepo,
	createTempDir,
	runCommand as execCommand,
} from '../utils/repo.js';
import { getSystemPrompt } from './prompts/index.js';

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

	try {
		// Clone repo to temp directory
		repoDir = createTempDir(project.id);
		cloneRepo(project, repoDir);

		logger.info('Running agent', { agentType, cardId, repoDir });

		// Get system prompt and model
		const systemPrompt = project.prompts?.[agentType] || getSystemPrompt(agentType);
		const model = project.model || config.defaults.model;
		const maxIterations = config.defaults.maxIterations;

		// Generate directory listing for codebase context
		const directoryListing = await generateDirectoryListing(repoDir, 3);
		const contextSection = directoryListing
			? `Here is the codebase directory structure (pre-populated for context):

<codebase_structure>
${directoryListing}
</codebase_structure>

`
			: '';

		const prompt = `${contextSection}Analyze and process the Trello card with ID: ${cardId}. Start by reading the card using ReadTrelloCard to get the current state, including any comments with instructions.`;

		// Change to repo directory (llmist gadgets use process.cwd() for path validation)
		const originalCwd = process.cwd();
		process.chdir(repoDir);

		logger.info('Starting llmist agent', { model, maxIterations, promptLength: prompt.length });

		try {
			// Create llmist client and logger
			const client = new LLMist();
			const llmistLogger = createLogger({ minLevel: getLogLevel() });

			// Build the agent
			const builder = new AgentBuilder(client)
				.withModel(model)
				.withSystem(systemPrompt)
				.withMaxIterations(maxIterations)
				.withLogger(llmistLogger)
				.withGadgets(
					// Filesystem gadgets from @llmist/cli (sandboxed to process.cwd())
					listDirectory,
					readFile,
					runCommand,
					// Trello gadgets
					new ReadTrelloCard(),
					new PostTrelloComment(),
					new UpdateTrelloCard(),
				);

			// Run the agent
			const agent = builder.ask(prompt);

			// Collect output
			const outputLines: string[] = [];
			let iterationCount = 0;

			for await (const event of agent.run()) {
				if (event.type === 'text') {
					logger.debug('[Text]', { content: event.content.slice(0, 100) });
					outputLines.push(event.content);
				} else if (event.type === 'gadget_call') {
					iterationCount++;
					logger.debug('[Gadget call]', { iteration: iterationCount });
				} else if (event.type === 'stream_complete') {
					logger.info('Stream complete', { iteration: iterationCount });
				}
			}

			logger.info('Agent completed', { cardId, iterations: iterationCount });

			return {
				success: true,
				output: outputLines.join('\n'),
			};
		} finally {
			// Restore original working directory
			process.chdir(originalCwd);
		}
	} catch (err) {
		logger.error('Agent execution failed', { agentType, error: String(err) });
		return {
			success: false,
			output: '',
			error: String(err),
		};
	} finally {
		// Cleanup temp directory
		if (repoDir) {
			try {
				cleanupTempDir(repoDir);
			} catch (err) {
				logger.warn('Failed to cleanup temp directory', { repoDir, error: String(err) });
			}
		}
	}
}
