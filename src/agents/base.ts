import type { createLogger } from 'llmist';
import { WriteFile } from '../gadgets/WriteFile.js';

import { CUSTOM_MODELS } from '../config/customModels.js';
import { AstGrep } from '../gadgets/AstGrep.js';
import { FileMultiEdit } from '../gadgets/FileMultiEdit.js';
import { FileSearchAndReplace } from '../gadgets/FileSearchAndReplace.js';
import { Finish } from '../gadgets/Finish.js';
import { ListDirectory } from '../gadgets/ListDirectory.js';
import { ReadFile } from '../gadgets/ReadFile.js';
import { RipGrep } from '../gadgets/RipGrep.js';
import { Sleep } from '../gadgets/Sleep.js';
import { VerifyChanges } from '../gadgets/VerifyChanges.js';
import { CreatePR } from '../gadgets/github/index.js';
import { Tmux } from '../gadgets/tmux.js';
import { TodoDelete, TodoUpdateStatus, TodoUpsert } from '../gadgets/todo/index.js';
import { type Todo, formatTodoList, initTodoSession, saveTodos } from '../gadgets/todo/storage.js';
import {
	AddChecklistToCard,
	CreateTrelloCard,
	// GetMyRecentActivity, // Temporarily disabled
	ListTrelloCards,
	PostTrelloComment,
	ReadTrelloCard,
	UpdateChecklistItem,
	UpdateTrelloCard,
	formatCardData,
} from '../gadgets/trello/index.js';
import { trelloClient } from '../trello/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import type { PromptContext } from './prompts/index.js';
import { type BuilderType, createConfiguredBuilder } from './shared/builderFactory.js';
import { type FileLogger, executeAgentLifecycle } from './shared/lifecycle.js';
import { resolveModelConfig } from './shared/modelResolution.js';
import { setupRepository as setupRepo } from './shared/repository.js';
import {
	injectContextFiles,
	injectDirectoryListing,
	injectSquintContext,
	injectSyntheticCall,
} from './shared/syntheticCalls.js';
import type { AgentLogger } from './utils/logging.js';
import type { TrackingContext } from './utils/tracking.js';

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
// Repository Setup
// ============================================================================

async function setupRepository(
	project: ProjectConfig,
	log: AgentLogger,
	agentType: string,
	prBranch?: string,
): Promise<string> {
	return setupRepo({ project, log, agentType, prBranch, warmTsCache: true });
}

// ============================================================================
// Agent Context Building
// ============================================================================

interface AgentContextData {
	systemPrompt: string;
	model: string;
	maxIterations: number;
	contextFiles: Awaited<ReturnType<typeof resolveModelConfig>>['contextFiles'];
	cardData: string;
	prompt: string;
	implementationSteps?: string[];
}

export async function fetchImplementationSteps(cardId: string): Promise<string[] | undefined> {
	try {
		const checklists = await trelloClient.getCardChecklists(cardId);
		const implChecklist = checklists.find((cl) => cl.name.includes('Implementation Steps'));
		if (!implChecklist || implChecklist.checkItems.length === 0) return undefined;
		const incompleteItems = implChecklist.checkItems.filter((item) => item.state !== 'complete');
		return incompleteItems.length > 0 ? incompleteItems.map((item) => item.name) : undefined;
	} catch {
		return undefined;
	}
}

async function buildAgentContext(
	agentType: string,
	cardId: string | undefined,
	repoDir: string,
	project: ProjectConfig,
	config: CascadeConfig,
	log: { info: (msg: string, ctx?: Record<string, unknown>) => void },
	triggerType?: string,
	prContext?: { prNumber: number; prBranch: string; repoFullName: string; headSha: string },
	debugContext?: {
		logDir: string;
		originalCardId: string;
		originalCardName: string;
		originalCardUrl: string;
		detectedAgentType: string;
	},
	modelOverride?: string,
): Promise<AgentContextData> {
	// Build prompt context for template rendering
	const promptContext: PromptContext = {
		cardId,
		cardUrl: cardId ? `https://trello.com/c/${cardId}` : undefined,
		projectId: project.id,
		baseBranch: project.baseBranch,
		storiesListId: project.trello?.lists?.stories,
		processedLabelId: project.trello?.labels?.processed,
		...(prContext && {
			prNumber: prContext.prNumber,
			prBranch: prContext.prBranch,
			repoFullName: prContext.repoFullName,
			headSha: prContext.headSha,
			triggerType,
		}),
		...(debugContext && {
			logDir: debugContext.logDir,
			originalCardId: debugContext.originalCardId,
			originalCardName: debugContext.originalCardName,
			originalCardUrl: debugContext.originalCardUrl,
			detectedAgentType: debugContext.detectedAgentType,
			debugListId: project.trello?.lists?.debug,
		}),
	};

	const { systemPrompt, model, maxIterations, contextFiles } = await resolveModelConfig({
		agentType,
		project,
		config,
		repoDir,
		modelOverride,
		promptContext,
	});

	// Pre-fetch card data for synthetic gadget call (only if cardId exists and not debug flow)
	let cardData = '';
	if (cardId && !debugContext) {
		log.info('Fetching card data for context', { cardId });
		cardData = await formatCardData(cardId, true);
	}

	// Pre-fetch implementation steps for synthetic todo injection
	let implementationSteps: string[] | undefined;
	if (agentType === 'implementation' && cardId && !debugContext) {
		implementationSteps = await fetchImplementationSteps(cardId);
	}

	// Build different prompt based on flow
	let prompt: string;
	if (prContext) {
		prompt = buildCheckFailurePrompt(prContext);
	} else if (debugContext) {
		prompt = buildDebugPrompt(debugContext);
	} else {
		prompt = buildPrompt(cardId ?? '');
	}

	return {
		systemPrompt,
		model,
		maxIterations,
		contextFiles,
		cardData,
		prompt,
		implementationSteps,
	};
}

function buildPrompt(cardId: string): string {
	return `Analyze and process the Trello card with ID: ${cardId}. The card data (title, description, checklists, attachments, comments) has been pre-loaded above. Review it and proceed with your task.`;
}

function buildCheckFailurePrompt(prContext: {
	prNumber: number;
	prBranch: string;
	repoFullName: string;
	headSha: string;
}): string {
	const [owner, repo] = prContext.repoFullName.split('/');

	return `You are on branch \`${prContext.prBranch}\` for PR #${prContext.prNumber}.

Your task is to fix the failing checks and push your changes.

## Instructions

1. **Investigate failures**: Use Tmux to run:
   \`gh run list --branch ${prContext.prBranch} --limit 5 --json databaseId,conclusion,status,workflowName\`

2. **Get failure details**: Find failed run ID and run:
   \`gh run view <run-id> --log-failed\`

3. **Analyze error types**:
   - Lint errors: Run \`npm run lint\` or \`pnpm run lint\`
   - Type errors: Run \`npm run typecheck\`
   - Test failures: Run \`npm test\`
   - Build errors: Run \`npm run build\`

4. **Fix issues**: Make targeted fixes following existing codebase patterns

5. **Verify locally**: Run the same checks that failed in CI before pushing

6. **Commit and push**:
   \`\`\`bash
   git add .
   git commit -m "fix: address failing checks"
   git push
   \`\`\`

The push will re-trigger checks automatically.

## GitHub Context
Owner: ${owner}
Repo: ${repo}
PR: #${prContext.prNumber}
Branch: ${prContext.prBranch}`;
}

function buildDebugPrompt(debugContext: {
	logDir: string;
	originalCardName: string;
	originalCardUrl: string;
	detectedAgentType: string;
}): string {
	return `Analyze the ${debugContext.detectedAgentType} agent session logs in directory: ${debugContext.logDir}

Original card: "${debugContext.originalCardName}"
Link: ${debugContext.originalCardUrl}

Start by listing the contents of the log directory, then read and analyze the logs to identify issues.`;
}

// ============================================================================
// Agent Builder Creation
// ============================================================================

function getBaseAgentGadgets(agentType: string) {
	// Planning agent is read-only - no file editing capabilities
	const isReadOnlyAgent = agentType === 'planning';

	return [
		// Filesystem gadgets (read-only for planning)
		new ListDirectory(),
		new ReadFile(),
		new RipGrep(),
		new AstGrep(),
		...(isReadOnlyAgent
			? []
			: [new FileSearchAndReplace(), new FileMultiEdit(), new WriteFile(), new VerifyChanges()]),
		// Shell commands via tmux (no timeout issues)
		new Tmux(),
		new Sleep(),
		// Task tracking gadgets
		new TodoUpsert(),
		new TodoUpdateStatus(),
		new TodoDelete(),
		// GitHub gadgets (no PR creation for planning)
		...(isReadOnlyAgent ? [] : [new CreatePR()]),
		// Trello gadgets
		new ReadTrelloCard(),
		new PostTrelloComment(),
		new UpdateTrelloCard(),
		new CreateTrelloCard(),
		new ListTrelloCards(),
		// new GetMyRecentActivity(), // Temporarily disabled
		new AddChecklistToCard(),
		// UpdateChecklistItem not available for planning - prevents marking items complete prematurely
		...(isReadOnlyAgent ? [] : [new UpdateChecklistItem()]),
		// Session control
		new Finish(),
	];
}

function createAgentBuilderWithGadgets(
	client: import('llmist').LLMist,
	ctx: AgentContextData,
	llmistLogger: ReturnType<typeof createLogger>,
	trackingContext: TrackingContext,
	agentType: string,
	logWriter: (level: string, message: string, context?: Record<string, unknown>) => void,
	llmCallLogger: import('../utils/llmLogging.js').LLMCallLogger,
	repoDir: string,
	cardId: string | undefined,
	remainingBudgetUsd?: number,
): BuilderType {
	// Build status update config if we have a cardId
	const statusUpdate = cardId
		? {
				cardId,
				agentType,
				maxIterations: ctx.maxIterations,
			}
		: undefined;

	return createConfiguredBuilder({
		client,
		agentType,
		model: ctx.model,
		systemPrompt: ctx.systemPrompt,
		maxIterations: ctx.maxIterations,
		llmistLogger,
		trackingContext,
		logWriter,
		llmCallLogger,
		repoDir,
		gadgets: getBaseAgentGadgets(agentType),
		statusUpdate,
		remainingBudgetUsd,
		// Implementation agent uses sequential execution to ensure file operations
		// are properly ordered (e.g., FileSearchAndReplace then ReadFile on same file)
		postConfigure:
			agentType === 'implementation'
				? (builder) => builder.withGadgetExecutionMode('sequential')
				: undefined,
	});
}

async function injectSyntheticCalls(
	initialBuilder: BuilderType,
	cardId: string | undefined,
	cardData: string,
	contextFiles: AgentContextData['contextFiles'],
	trackingContext: TrackingContext,
	repoDir: string,
	implementationSteps?: string[],
): Promise<BuilderType> {
	// Use maxDepth=5 to give agents better visibility into nested structures
	let builder = injectDirectoryListing(initialBuilder, trackingContext, 5);

	// Inject context files (CLAUDE.md, AGENTS.md) — conventions first
	builder = injectContextFiles(builder, trackingContext, contextFiles);

	// Inject Squint overview BEFORE card data — agent sees architectural map
	// before encountering specific file paths from the card
	builder = injectSquintContext(builder, trackingContext, repoDir);

	// Inject card data as synthetic ReadTrelloCard call (only if cardId exists)
	if (cardId && cardData) {
		builder = injectSyntheticCall(
			builder,
			trackingContext,
			'ReadTrelloCard',
			{ cardId, includeComments: true },
			cardData,
			'gc_card',
		);
	}

	// Inject pre-populated todos LAST — strongest "start coding" signal
	if (implementationSteps && implementationSteps.length > 0) {
		initTodoSession(`impl-${Date.now()}`);

		const now = new Date().toISOString();
		const todos: Todo[] = implementationSteps.map((step, i) => ({
			id: String(i + 1),
			content: step,
			status: 'pending' as const,
			createdAt: now,
			updatedAt: now,
		}));
		saveTodos(todos);

		builder = injectSyntheticCall(
			builder,
			trackingContext,
			'TodoUpsert',
			{
				items: implementationSteps.map((step) => ({ content: step })),
				comment: 'Pre-populated from Implementation Steps checklist',
			},
			`➕ Created ${todos.length} todos.\n\n${formatTodoList(todos)}`,
			'gc_todos',
		);
	}

	return builder;
}

// ============================================================================
// Agent Execution
// ============================================================================

interface PRContext {
	prNumber: number;
	prBranch: string;
	repoFullName: string;
	headSha: string;
}

function extractPRContext(input: AgentInput): PRContext | undefined {
	if (input.triggerType !== 'check-failure') return undefined;
	return {
		prNumber: input.prNumber as number,
		prBranch: input.prBranch as string,
		repoFullName: input.repoFullName as string,
		headSha: input.headSha as string,
	};
}

function extractDebugContext(agentType: string, input: AgentInput) {
	if (agentType !== 'debug' || !input.logDir) return undefined;
	return {
		logDir: input.logDir,
		originalCardId: input.originalCardId as string,
		originalCardName: input.originalCardName as string,
		originalCardUrl: input.originalCardUrl as string,
		detectedAgentType: input.detectedAgentType as string,
	};
}

function getLoggerIdentifier(
	agentType: string,
	cardId: string | undefined,
	prContext: PRContext | undefined,
	debugCardId: string | undefined,
): string {
	if (prContext) return `${agentType}-pr${prContext.prNumber}`;
	return `${agentType}-${cardId || debugCardId}`;
}

async function setupWorkingDirectory(
	input: AgentInput,
	project: ProjectConfig,
	log: AgentLogger,
	agentType: string,
	prBranch?: string,
): Promise<string> {
	if (input.logDir && typeof input.logDir === 'string') {
		log.info('Using log directory (no repo setup)', { logDir: input.logDir });
		return input.logDir;
	}

	return setupRepository(project, log, agentType, prBranch);
}

function extractPRUrl(output: string): string | undefined {
	const match = output.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
	return match ? match[0] : undefined;
}

export async function executeAgent(
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
): Promise<AgentResult> {
	const { project, config, cardId, interactive, autoAccept } = input;
	const prContext = extractPRContext(input);
	const isDebugAgent = input.logDir && typeof input.logDir === 'string';

	if (!cardId && !prContext && !isDebugAgent) {
		return { success: false, output: '', error: 'No card ID or PR context provided' };
	}

	const debugCardId = isDebugAgent ? (input.originalCardId as string) : undefined;
	const identifier = getLoggerIdentifier(agentType, cardId, prContext, debugCardId);

	return executeAgentLifecycle<AgentContextData>({
		loggerIdentifier: identifier,

		onWatchdogTimeout: async (fileLogger: FileLogger) => {
			if (cardId) {
				const logBuffer = await fileLogger.getZippedBuffer();
				const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
				const logName = `${agentType}-timeout-${timestamp}.zip`;
				await trelloClient.addAttachmentFile(cardId, logBuffer, logName);
				logger.info('Uploaded timeout log to card', { cardId, logName });
			}
		},

		setupRepoDir: (log) =>
			setupWorkingDirectory(input, project, log, agentType, prContext?.prBranch),

		buildContext: (repoDir, log) => {
			const debugContext = extractDebugContext(agentType, input);
			return buildAgentContext(
				agentType,
				cardId,
				repoDir,
				project,
				config,
				log,
				input.triggerType,
				prContext,
				debugContext,
				input.modelOverride,
			);
		},

		createBuilder: ({ client, ctx, llmistLogger, trackingContext, fileLogger, repoDir }) =>
			createAgentBuilderWithGadgets(
				client,
				ctx,
				llmistLogger,
				trackingContext,
				agentType,
				fileLogger.write.bind(fileLogger),
				fileLogger.llmCallLogger,
				repoDir,
				cardId,
				input.remainingBudgetUsd as number | undefined,
			),

		injectSyntheticCalls: ({ builder, ctx, trackingContext, repoDir }) =>
			injectSyntheticCalls(
				builder,
				cardId,
				ctx.cardData,
				ctx.contextFiles,
				trackingContext,
				repoDir,
				ctx.implementationSteps,
			),

		interactive,
		autoAccept,
		customModels: CUSTOM_MODELS,

		postProcess: (output) => {
			const prUrl = extractPRUrl(output);
			return prUrl ? { prUrl } : {};
		},
	});
}
