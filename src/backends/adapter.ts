import type { ModelSpec } from 'llmist';

import type { PromptContext } from '../agents/prompts/index.js';
import { cleanupAgentResources } from '../agents/shared/cleanup.js';
import { resolveModelConfig } from '../agents/shared/modelResolution.js';
import { buildPromptContext } from '../agents/shared/promptContext.js';
import { setupRepository } from '../agents/shared/repository.js';
import {
	type RunTrackingInput,
	finalizeBackendRun,
	tryCreateRun,
} from '../agents/shared/runTracking.js';
import { createAgentLogger } from '../agents/utils/logging.js';
import { CUSTOM_MODELS } from '../config/customModels.js';
import { loadPartials } from '../db/repositories/partialsRepository.js';
import { withGitHubToken } from '../github/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { loadCascadeEnv, unloadCascadeEnv } from '../utils/cascadeEnv.js';
import { createFileLogger } from '../utils/fileLogger.js';
import { setWatchdogCleanup } from '../utils/lifecycle.js';
import { logger } from '../utils/logging.js';
import { setupRemoteSquintDb } from '../utils/squintDb.js';
import { getAgentProfile } from './agent-profiles.js';
import { postProcessResult } from './postProcess.js';
import { createProgressMonitor } from './progress.js';
import { augmentProjectSecrets, resolveGitHubToken } from './secretBuilder.js';
import { getToolManifests } from './toolManifests.js';
import type { AgentBackend, AgentBackendInput, LogWriter } from './types.js';

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
 * Create a LogWriter that writes to both the file logger and the structured logger.
 */
function createLogWriter(fileLogger: ReturnType<typeof createFileLogger>): LogWriter {
	return (level: string, message: string, context?: Record<string, unknown>) => {
		fileLogger.write(level, message, context);
		const logFn =
			level === 'ERROR'
				? logger.error
				: level === 'WARN'
					? logger.warn
					: level === 'DEBUG'
						? logger.debug
						: logger.info;
		logFn.call(logger, message, context);
	};
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

	const { systemPrompt, model, maxIterations, contextFiles } = await resolveModelConfig({
		agentType,
		project,
		config,
		repoDir,
		promptContext,
		dbPartials,
	});

	const profile = getAgentProfile(agentType);

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
		taskPrompt: profile.buildTaskPrompt(input),
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

export async function executeWithBackend(
	backend: AgentBackend,
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
): Promise<AgentResult> {
	const { cardId } = input;
	let repoDir: string | null = null;
	let runId: string | undefined;
	const startTime = Date.now();

	const identifier = `${agentType}-${cardId || 'unknown'}`;
	const fileLogger = createFileLogger(`cascade-${identifier}`);
	const log = createAgentLogger(fileLogger);

	setWatchdogCleanup(async () => {
		fileLogger.close();
		await finalizeBackendRun(runId, fileLogger, {
			status: 'timed_out',
			durationMs: Date.now() - startTime,
			success: false,
			error: 'Watchdog timeout',
		});
	});

	try {
		repoDir = await resolveRepoDir(input, log, agentType);
		const envSnapshot = loadCascadeEnv(repoDir, log);
		const squintCleanup = await setupRemoteSquintDb(repoDir, input.project, log);
		const logWriter = createLogWriter(fileLogger);

		const profile = getAgentProfile(agentType);
		const gitHubToken = await resolveGitHubToken(profile, input.project.id, agentType);

		// Build backend input wrapped in GitHub token scope if needed
		const buildPartial = () =>
			buildBackendInput(agentType, input, repoDir as string, logWriter, log, gitHubToken);

		const partialInput = gitHubToken
			? await withGitHubToken(gitHubToken, buildPartial)
			: await buildPartial();

		const runTrackingInput: RunTrackingInput = {
			projectId: input.project.id,
			cardId: input.cardId,
			prNumber: input.prNumber,
			agentType,
			backendName: backend.name,
			triggerType: input.triggerType,
		};
		runId = await tryCreateRun(runTrackingInput, partialInput.model, partialInput.maxIterations);

		const monitor = createProgressMonitor({
			logWriter,
			agentType,
			taskDescription: cardId ? `Work item ${cardId}` : 'Unknown task',
			progressModel: input.config.defaults.progressModel,
			intervalMinutes: input.config.defaults.progressIntervalMinutes,
			customModels: CUSTOM_MODELS as ModelSpec[],
			repoDir: repoDir ?? undefined,
			trello: cardId ? { cardId } : undefined,
		});

		const backendInput: AgentBackendInput = {
			...partialInput,
			progressReporter: monitor ?? {
				onIteration: async () => {},
				onToolCall: () => {},
				onText: () => {},
			},
			runId,
		};

		const originalCwd = process.cwd();
		process.chdir(repoDir);
		monitor?.start();

		try {
			const result = await backend.execute(backendInput);
			postProcessResult(result, agentType, backend, input, identifier);

			fileLogger.close();
			const logBuffer = await fileLogger.getZippedBuffer();

			const durationMs = Date.now() - startTime;
			await finalizeBackendRun(runId, fileLogger, {
				status: result.success ? 'completed' : 'failed',
				durationMs,
				costUsd: result.cost,
				success: result.success,
				error: result.error,
				prUrl: result.prUrl,
				outputSummary: result.output.slice(0, 500),
			});

			return {
				success: result.success,
				output: result.output,
				prUrl: result.prUrl,
				progressCommentId: monitor?.getProgressCommentId() ?? undefined,
				error: result.error,
				cost: result.cost,
				logBuffer: logBuffer ?? result.logBuffer,
				runId,
				durationMs,
			};
		} finally {
			monitor?.stop();
			process.chdir(originalCwd);
			squintCleanup?.();
			unloadCascadeEnv(envSnapshot);
		}
	} catch (err) {
		logger.error('Backend execution failed', {
			identifier,
			backend: backend.name,
			error: String(err),
		});

		let logBuffer: Buffer | undefined;
		try {
			fileLogger.close();
			logBuffer = await fileLogger.getZippedBuffer();
		} catch {
			// Ignore log buffer errors
		}

		const durationMs = Date.now() - startTime;
		await finalizeBackendRun(runId, fileLogger, {
			status: 'failed',
			durationMs,
			success: false,
			error: String(err),
		});

		return { success: false, output: '', error: String(err), logBuffer, runId, durationMs };
	} finally {
		cleanupAgentResources(repoDir, fileLogger, Boolean(input.logDir));
	}
}
