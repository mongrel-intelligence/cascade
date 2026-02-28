import type { ModelSpec } from 'llmist';

import type { PromptContext } from '../agents/prompts/index.js';
import {
	type LogWriter,
	type PipelineContext,
	executeAgentPipeline,
} from '../agents/shared/executionPipeline.js';
import { resolveModelConfig } from '../agents/shared/modelResolution.js';
import { buildPromptContext } from '../agents/shared/promptContext.js';
import { setupRepository } from '../agents/shared/repository.js';
import { finalizeBackendRun, tryCreateRun } from '../agents/shared/runTracking.js';
import { createAgentLogger } from '../agents/utils/logging.js';
import { CUSTOM_MODELS } from '../config/customModels.js';
import { loadPartials } from '../db/repositories/partialsRepository.js';
import { recordInitialComment } from '../gadgets/sessionState.js';
import { withGitHubToken } from '../github/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { getAgentProfile } from './agent-profiles.js';
import { postProcessResult } from './postProcess.js';
import { createProgressMonitor } from './progress.js';
import { augmentProjectSecrets, resolveGitHubToken } from './secretBuilder.js';
import { getToolManifests } from './toolManifests.js';
import type { AgentBackend, AgentBackendInput } from './types.js';

/**
 * Resolve the working directory — either a pre-existing log dir or a fresh repo clone.
 */
async function resolveRepoDir(
	input: AgentInput & { project: ProjectConfig },
	log: ReturnType<typeof createAgentLogger>,
	agentType: string,
): Promise<string> {
	if (input.logDir && typeof input.logDir === 'string') {
		return input.logDir;
	}
	return setupRepository({
		project: input.project,
		log,
		agentType,
		prBranch: input.prBranch,
		warmTsCache: true,
	});
}

/**
 * Build the BackendInput by resolving model config, fetching context, etc.
 * Uses agent profiles to customize tools, context, and prompts per agent type.
 */
async function buildBackendInput(
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
	repoDir: string,
	logWriter: LogWriter,
	_log: ReturnType<typeof createAgentLogger>,
	gitHubToken: string | undefined,
): Promise<Omit<AgentBackendInput, 'progressReporter'>> {
	const { project, config, cardId } = input;

	// PR context from check-failure trigger
	const prContext =
		input.prNumber !== undefined
			? {
					prNumber: input.prNumber as number,
					prBranch: input.prBranch as string,
					repoFullName: input.repoFullName as string,
					headSha: input.headSha as string,
				}
			: undefined;

	const promptContext: PromptContext = buildPromptContext(
		cardId,
		project,
		input.triggerType,
		prContext,
	);

	// Load DB partials for template include resolution
	let dbPartials: Map<string, string> | undefined;
	try {
		dbPartials = await loadPartials(project.orgId);
	} catch {
		// DB not available — fall back to disk-only partials
	}

	const {
		systemPrompt,
		taskPrompt: taskPromptOverride,
		model,
		maxIterations,
		contextFiles,
	} = await resolveModelConfig({
		agentType,
		project,
		config,
		repoDir,
		promptContext,
		dbPartials,
		agentInput: input,
	});

	const profile = await getAgentProfile(agentType);

	// Use profile to fetch agent-specific context injections
	const contextInjections = await profile.fetchContext({
		input,
		repoDir,
		contextFiles,
		logWriter,
	});

	const cliToolsDir = new URL('../../bin', import.meta.url).pathname;

	// Build per-project secrets with CASCADE env var injections
	const projectSecrets = await augmentProjectSecrets(project, agentType, input);

	// Override GITHUB_TOKEN in subprocess secrets with agent-scoped token
	if (gitHubToken && profile.needsGitHubToken) {
		projectSecrets.GITHUB_TOKEN = gitHubToken;
	}

	// Pre-execute hook (e.g., post initial PR comment for review)
	if (profile.preExecute) {
		await profile.preExecute({ input, logWriter });
	}

	return {
		agentType,
		project,
		config,
		repoDir,
		systemPrompt,
		taskPrompt: taskPromptOverride ?? profile.buildTaskPrompt(input),
		cliToolsDir,
		availableTools: profile.filterTools(getToolManifests()),
		contextInjections,
		maxIterations,
		budgetUsd: input.remainingBudgetUsd as number | undefined,
		model,
		logWriter,
		agentInput: input,
		sdkTools: profile.sdkTools,
		enableStopHooks: profile.enableStopHooks,
		blockGitPush: profile.blockGitPush,
		...(Object.keys(projectSecrets).length > 0 && { projectSecrets }),
	};
}

/**
 * Build progress-monitor config from pipeline inputs.
 */
function buildProgressMonitorConfig(
	input: AgentInput & { config: CascadeConfig },
	agentType: string,
	logWriter: LogWriter,
	repoDir: string | null,
	isGitHubAck: boolean,
) {
	const { cardId } = input;
	return {
		logWriter,
		agentType,
		taskDescription: cardId ? `Work item ${cardId}` : 'Unknown task',
		progressModel: input.config.defaults.progressModel,
		intervalMinutes: input.config.defaults.progressIntervalMinutes,
		customModels: CUSTOM_MODELS as ModelSpec[],
		repoDir: repoDir ?? undefined,
		trello: cardId ? { cardId } : undefined,
		preSeededCommentId: isGitHubAck ? undefined : (input.ackCommentId as string | undefined),
		...(input.prNumber && input.repoFullName
			? {
					github: {
						owner: input.repoFullName.split('/')[0],
						repo: input.repoFullName.split('/')[1],
						headerMessage: input.ackMessage ?? '',
					},
				}
			: {}),
	};
}

export async function executeWithBackend(
	backend: AgentBackend,
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
): Promise<AgentResult> {
	const { cardId } = input;
	const identifier = `${agentType}-${cardId || 'unknown'}`;

	return executeAgentPipeline({
		loggerIdentifier: identifier,

		setupRepoDir: (log) => resolveRepoDir(input, log, agentType),

		skipRepoDeletion: Boolean(input.logDir),

		squintDbUrl: input.project.squintDbUrl,

		finalizeRun: (runId, fileLogger, outcome) =>
			finalizeBackendRun(runId, fileLogger, {
				status: outcome.status,
				durationMs: outcome.durationMs,
				success: outcome.success,
				error: outcome.error,
				costUsd: outcome.costUsd,
				prUrl: outcome.prUrl,
				outputSummary: outcome.outputSummary,
			}),

		execute: async (ctx: PipelineContext) => {
			const { repoDir, fileLogger, logWriter, setRunId } = ctx;
			const log = createAgentLogger(fileLogger);

			const profile = await getAgentProfile(agentType);
			const gitHubToken = await resolveGitHubToken(profile, input.project.id, agentType);

			// Build backend input wrapped in GitHub token scope if needed
			const buildPartial = () =>
				buildBackendInput(agentType, input, repoDir, logWriter, log, gitHubToken);

			const partialInput = gitHubToken
				? await withGitHubToken(gitHubToken, buildPartial)
				: await buildPartial();

			// Create run record now that we have model and maxIterations
			const runId = await tryCreateRun(
				{
					projectId: input.project.id,
					cardId: input.cardId,
					prNumber: input.prNumber as number | undefined,
					agentType,
					backendName: backend.name,
					triggerType: input.triggerType,
				},
				partialInput.model,
				partialInput.maxIterations,
			);
			if (runId) setRunId(runId);

			// Determine if the ack comment is a GitHub PR comment (numeric ID) vs PM comment (string ID)
			const isGitHubAck = Boolean(
				input.prNumber && input.repoFullName && typeof input.ackCommentId === 'number',
			);

			// Seed session state so GitHub progress updates target the existing ack comment
			if (isGitHubAck) {
				recordInitialComment(input.ackCommentId as number);
			}

			const monitor = createProgressMonitor(
				buildProgressMonitorConfig(input, agentType, logWriter, repoDir, isGitHubAck),
			);

			const backendInput: AgentBackendInput = {
				...partialInput,
				progressReporter: monitor ?? {
					onIteration: async () => {},
					onToolCall: () => {},
					onText: () => {},
				},
				runId,
				llmistLogPath: fileLogger.llmistLogPath,
			};

			monitor?.start();
			let result: Awaited<ReturnType<typeof backend.execute>>;
			try {
				result = await backend.execute(backendInput);
			} finally {
				monitor?.stop();
			}

			postProcessResult(result, agentType, backend, input, identifier, {
				requiresPR: profile.requiresPR,
			});

			return {
				success: result.success,
				output: result.output,
				prUrl: result.prUrl,
				progressCommentId: monitor?.getProgressCommentId() ?? undefined,
				error: result.error,
				cost: result.cost,
				logBuffer: result.logBuffer,
			};
		},
	});
}
