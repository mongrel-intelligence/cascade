import type { ModelSpec } from 'llmist';

import { createProgressMonitor } from '../backends/progress.js';
import { CUSTOM_MODELS } from '../config/customModels.js';
import { getPMProvider } from '../pm/index.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { extractPRUrl } from '../utils/prUrl.js';
import { type FileLogger, executeAgentLifecycle } from './shared/lifecycle.js';
import { setupRepository as setupRepo } from './shared/repository.js';
import {
	createWorkItemAgentBuilder,
	injectWorkItemSyntheticCalls,
} from './shared/workItemBuilder.js';
import { buildAgentContext } from './shared/workItemContext.js';
import type { AgentLogger } from './utils/logging.js';

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

// Re-export for backwards compatibility and test access
export { fetchImplementationSteps } from './shared/workItemContext.js';

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

	return setupRepo({ project, log, agentType, prBranch, warmTsCache: true });
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

	return executeAgentLifecycle({
		loggerIdentifier: identifier,

		onWatchdogTimeout: async (_fileLogger: FileLogger, runId?: string) => {
			if (cardId) {
				try {
					const provider = getPMProvider();
					await provider.addComment(
						cardId,
						`⏱️ Agent timed out (watchdog).${runId ? ` Run ID: ${runId}` : ''}`,
					);
					logger.info('Posted timeout comment to work item', { cardId, runId });
				} catch {
					logger.warn('Failed to post timeout comment', { cardId, runId });
				}
			}
		},

		setupRepoDir: (log) =>
			setupWorkingDirectory(input, project, log, agentType, prContext?.prBranch),

		buildContext: (repoDir, log) => {
			const debugContext = extractDebugContext(agentType, input);
			const commentContext = input.triggerCommentText
				? { text: input.triggerCommentText, author: input.triggerCommentAuthor || 'unknown' }
				: undefined;
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
				commentContext,
			);
		},

		createBuilder: ({
			client,
			ctx,
			llmistLogger,
			trackingContext,
			fileLogger,
			repoDir,
			progressMonitor,
			llmCallAccumulator,
			runId,
		}) =>
			createWorkItemAgentBuilder({
				client,
				ctx,
				llmistLogger,
				trackingContext,
				agentType,
				logWriter: fileLogger.write.bind(fileLogger),
				llmCallLogger: fileLogger.llmCallLogger,
				repoDir,
				progressMonitor: progressMonitor ?? undefined,
				remainingBudgetUsd: input.remainingBudgetUsd as number | undefined,
				llmCallAccumulator,
				runId,
				baseBranch: project.baseBranch,
				projectId: project.id,
				cardId,
			}),

		injectSyntheticCalls: ({ builder, ctx, trackingContext, repoDir }) =>
			injectWorkItemSyntheticCalls(
				builder,
				cardId,
				ctx.cardData,
				ctx.contextFiles,
				trackingContext,
				repoDir,
				ctx.implementationSteps,
			),

		createProgressMonitor: (fileLogger, repoDir) =>
			createProgressMonitor({
				logWriter: fileLogger.write.bind(fileLogger),
				agentType,
				taskDescription: cardId ? `Work item ${cardId}` : 'Unknown task',
				progressModel: config.defaults.progressModel,
				intervalMinutes: config.defaults.progressIntervalMinutes,
				customModels: CUSTOM_MODELS as ModelSpec[],
				repoDir,
				trello: cardId ? { cardId } : undefined,
				preSeededCommentId: input.ackCommentId as string | undefined,
			}),

		interactive,
		autoAccept,
		customModels: CUSTOM_MODELS,

		postProcess: (output) => {
			const prUrl = extractPRUrl(output);
			return prUrl ? { prUrl } : {};
		},

		runTracking: {
			projectId: project.id,
			cardId,
			prNumber: prContext?.prNumber ?? (input.prNumber as number | undefined),
			agentType,
			backendName: 'llmist',
			triggerType: input.triggerType,
		},

		squintDbUrl: project.squintDbUrl,
	});
}
