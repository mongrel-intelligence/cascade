import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ModelSpec } from 'llmist';

import { needsGitStateStopHooks } from '../agents/definitions/index.js';
import { getAgentProfile } from '../agents/definitions/profiles.js';
import { getToolManifests } from '../agents/definitions/toolManifests.js';
import type { PromptContext } from '../agents/prompts/index.js';
import {
	type LogWriter,
	type PipelineContext,
	executeAgentPipeline,
} from '../agents/shared/executionPipeline.js';
import { resolveModelConfig } from '../agents/shared/modelResolution.js';
import { buildPromptContext } from '../agents/shared/promptContext.js';
import { setupRepository } from '../agents/shared/repository.js';
import { finalizeEngineRun, tryCreateRun } from '../agents/shared/runTracking.js';
import { createAgentLogger } from '../agents/utils/logging.js';
import { CUSTOM_MODELS } from '../config/customModels.js';
import { loadPartials } from '../db/repositories/partialsRepository.js';
import {
	PR_SIDECAR_ENV_VAR,
	PUSHED_CHANGES_SIDECAR_ENV_VAR,
	REVIEW_SIDECAR_ENV_VAR,
	clearInitialComment,
	recordInitialComment,
	recordPRCreation,
	recordReviewSubmission,
} from '../gadgets/sessionState.js';
import { withGitHubToken } from '../github/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { getDashboardUrl } from '../utils/runLink.js';
import { readCompletionEvidence } from './completion.js';
import { createNativeToolRuntimeArtifacts } from './nativeToolRuntime.js';
import { postProcessResult } from './postProcess.js';
import { createProgressMonitor } from './progress.js';
import {
	augmentProjectSecrets,
	injectGitHubAckCommentId,
	injectProgressCommentId,
	resolveGitHubToken,
} from './secretBuilder.js';
import type { AgentEngine, AgentExecutionPlan } from './types.js';

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

function createCompletionArtifacts(
	profile: Awaited<ReturnType<typeof getAgentProfile>>,
	agentType: string,
	needsNativeToolRuntime: boolean,
	input: AgentInput,
	projectSecrets: Record<string, string>,
) {
	const reviewSidecarPath =
		agentType === 'review'
			? join(tmpdir(), `cascade-review-sidecar-${process.pid}-${Date.now()}.json`)
			: undefined;
	if (reviewSidecarPath) {
		projectSecrets[REVIEW_SIDECAR_ENV_VAR] = reviewSidecarPath;
	}

	const prSidecarPath =
		needsNativeToolRuntime && profile.finishHooks.requiresPR
			? join(tmpdir(), `cascade-pr-sidecar-${process.pid}-${Date.now()}.json`)
			: undefined;
	if (prSidecarPath) {
		projectSecrets[PR_SIDECAR_ENV_VAR] = prSidecarPath;
	}

	const pushedChangesSidecarPath =
		needsNativeToolRuntime && profile.finishHooks.requiresPushedChanges
			? join(tmpdir(), `cascade-pushed-changes-sidecar-${process.pid}-${Date.now()}.json`)
			: undefined;
	if (pushedChangesSidecarPath) {
		projectSecrets[PUSHED_CHANGES_SIDECAR_ENV_VAR] = pushedChangesSidecarPath;
	}

	if (Object.keys(profile.finishHooks).length > 0) {
		projectSecrets.CASCADE_FINISH_HOOKS = JSON.stringify(profile.finishHooks);
	}
	if (input.headSha) {
		projectSecrets.CASCADE_INITIAL_HEAD_SHA = input.headSha as string;
	}

	return {
		prSidecarPath,
		pushedChangesSidecarPath,
		reviewSidecarPath,
	};
}

/**
 * Build the execution plan by resolving model config, fetching context, etc.
 * Uses agent profiles to customize tools, context, and prompts per agent type.
 */
async function buildExecutionPlan(
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
	repoDir: string,
	logWriter: LogWriter,
	_log: ReturnType<typeof createAgentLogger>,
	gitHubToken: string | undefined,
	isGitHubAck: boolean,
	engineId: string,
): Promise<
	Omit<AgentExecutionPlan, 'progressReporter'> & {
		reviewSidecarPath?: string;
		prSidecarPath?: string;
		pushedChangesSidecarPath?: string;
		nativeToolRuntimeCleanup?: () => void;
	}
> {
	const { project, config, workItemId } = input;

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
		workItemId,
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
		project,
	});

	const cliToolsDir = new URL('../../bin', import.meta.url).pathname;
	const needsNativeToolRuntime = ['claude-code', 'codex', 'opencode'].includes(engineId);
	const nativeToolRuntime = needsNativeToolRuntime ? createNativeToolRuntimeArtifacts() : undefined;

	// Build per-project secrets with CASCADE env var injections
	const projectSecrets = await augmentProjectSecrets(project, agentType, input);

	// Inject pre-seeded progress comment ID so the subprocess finds it at startup
	injectProgressCommentId(
		projectSecrets,
		workItemId,
		input.ackCommentId as string | number | undefined,
	);

	// Inject GitHub ack comment ID so the subprocess can delete it after review submission
	injectGitHubAckCommentId(
		projectSecrets,
		input.ackCommentId as string | number | undefined,
		isGitHubAck,
	);

	const { reviewSidecarPath, prSidecarPath, pushedChangesSidecarPath } = createCompletionArtifacts(
		profile,
		agentType,
		needsNativeToolRuntime,
		input,
		projectSecrets,
	);

	const completionRequirements = {
		requiresPR: profile.finishHooks.requiresPR,
		requiresReview: profile.finishHooks.requiresReview,
		requiresPushedChanges: profile.finishHooks.requiresPushedChanges,
		prSidecarPath,
		reviewSidecarPath,
		pushedChangesSidecarPath,
		maxContinuationTurns: 1,
	};

	// Override GITHUB_TOKEN in subprocess secrets with agent-scoped token
	if (gitHubToken && profile.needsGitHubToken) {
		projectSecrets.GITHUB_TOKEN = gitHubToken;
	}

	return {
		agentType,
		project,
		config,
		repoDir,
		systemPrompt,
		taskPrompt: taskPromptOverride ?? profile.buildTaskPrompt(input),
		cliToolsDir,
		nativeToolShimDir: nativeToolRuntime?.shimDir,
		availableTools: profile.filterTools(getToolManifests()),
		contextInjections,
		maxIterations,
		budgetUsd: input.remainingBudgetUsd as number | undefined,
		model,
		logWriter,
		agentInput: input,
		nativeToolCapabilities: profile.allCapabilities,
		completionRequirements,
		enableStopHooks: needsGitStateStopHooks(profile.finishHooks),
		blockGitPush: profile.finishHooks.blockGitPush,
		...(Object.keys(projectSecrets).length > 0 && { projectSecrets }),
		reviewSidecarPath,
		prSidecarPath,
		pushedChangesSidecarPath,
		nativeToolRuntimeCleanup: nativeToolRuntime?.cleanup,
	};
}

/**
 * Read the review sidecar file written by `cascade-tools scm create-pr-review`
 * and hydrate session state so `postReviewSummaryToPM()` can post to the PM.
 *
 * Only needed for the claude-code backend where tools run as child processes
 * and cannot update the parent process's module-level session state directly.
 */
async function hydrateReviewSidecar(sidecarPath: string): Promise<void> {
	try {
		const sidecar = readCompletionEvidence({ reviewSidecarPath: sidecarPath });
		if (sidecar.reviewBody && sidecar.reviewUrl) {
			recordReviewSubmission(sidecar.reviewUrl, sidecar.reviewBody, sidecar.reviewEvent);
			logger.info('Hydrated review sidecar from subprocess', {
				event: sidecar.reviewEvent,
				bodyLength: sidecar.reviewBody.length,
			});
		} else {
			logger.warn('Review sidecar missing required fields', {
				hasBody: !!sidecar.reviewBody,
				hasReviewUrl: !!sidecar.reviewUrl,
			});
		}
		// If the subprocess already deleted the ack comment, clear it from session state
		// so the GitHubProgressPoster post-agent callback does not attempt a redundant delete.
		if (sidecar.ackCommentDeleted) {
			clearInitialComment();
		}
	} catch (err) {
		// Sidecar not written by subprocess (agent may have failed before review) or malformed.
		logger.warn('Failed to read review sidecar', { path: sidecarPath, error: String(err) });
	}
}

async function hydratePrSidecar(sidecarPath: string): Promise<{
	prUrl?: string;
	prEvidence?: { source: 'native-tool-sidecar'; authoritative: true; command: string };
}> {
	try {
		const sidecar = readCompletionEvidence({ prSidecarPath: sidecarPath });
		if (sidecar.prUrl) {
			recordPRCreation(sidecar.prUrl);
			logger.info('Hydrated PR sidecar from subprocess', {
				command: sidecar.prCommand ?? 'cascade-tools scm create-pr',
				prUrl: sidecar.prUrl,
			});
			return {
				prUrl: sidecar.prUrl,
				prEvidence: {
					source: 'native-tool-sidecar',
					authoritative: true,
					command: sidecar.prCommand ?? 'cascade-tools scm create-pr',
				},
			};
		}
		logger.warn('PR sidecar missing required fields', {
			hasPrUrl: !!sidecar.prUrl,
		});
	} catch (err) {
		logger.warn('Failed to read PR sidecar', { path: sidecarPath, error: String(err) });
	}

	return {};
}

/**
 * Build progress-monitor config from pipeline inputs.
 */
function buildProgressMonitorConfig(
	input: AgentInput & { config: CascadeConfig; project: ProjectConfig },
	agentType: string,
	logWriter: LogWriter,
	repoDir: string | null,
	isGitHubAck: boolean,
	engineId: string,
	model: string,
) {
	const { workItemId } = input;

	// Build run link config when the project has run links enabled and dashboard URL is set
	const runLink =
		input.project.runLinksEnabled && getDashboardUrl()
			? {
					engineLabel: engineId,
					model,
					projectId: input.project.id,
					workItemId: workItemId ?? undefined,
				}
			: undefined;

	return {
		logWriter,
		agentType,
		taskDescription: workItemId ? `Work item ${workItemId}` : 'Unknown task',
		progressModel: input.config.defaults.progressModel,
		intervalMinutes: input.config.defaults.progressIntervalMinutes,
		customModels: CUSTOM_MODELS as ModelSpec[],
		repoDir: repoDir ?? undefined,
		trello: workItemId ? { workItemId } : undefined,
		preSeededCommentId: isGitHubAck ? undefined : (input.ackCommentId as string | undefined),
		runLink,
		...(input.prNumber && input.repoFullName
			? {
					github: {
						owner: input.repoFullName.split('/')[0],
						repo: input.repoFullName.split('/')[1],
					},
				}
			: {}),
	};
}

function isGitHubAckComment(input: AgentInput): boolean {
	return Boolean(input.prNumber && input.repoFullName && typeof input.ackCommentId === 'number');
}

function cleanupTempFile(path: string | undefined): void {
	if (!path) return;
	try {
		unlinkSync(path);
	} catch {
		// Best-effort cleanup
	}
}

async function resolvePartialExecutionPlan(
	engine: AgentEngine,
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
	repoDir: string,
	logWriter: LogWriter,
	log: ReturnType<typeof createAgentLogger>,
): Promise<Awaited<ReturnType<typeof buildExecutionPlan>>> {
	const profile = await getAgentProfile(agentType);
	const gitHubToken = await resolveGitHubToken(profile, input.project.id, agentType);
	const isGitHubAck = isGitHubAckComment(input);
	const buildPartial = () =>
		buildExecutionPlan(
			agentType,
			input,
			repoDir,
			logWriter,
			log,
			gitHubToken,
			isGitHubAck,
			engine.definition.id,
		);

	const partialInput = gitHubToken
		? await withGitHubToken(gitHubToken, buildPartial)
		: await buildPartial();

	return partialInput;
}

async function hydrateNativeToolSidecars(
	result: Awaited<ReturnType<AgentEngine['execute']>>,
	prSidecarPath?: string,
	reviewSidecarPath?: string,
): Promise<void> {
	if (prSidecarPath) {
		const hydratedPr = await hydratePrSidecar(prSidecarPath);
		if (hydratedPr.prUrl) {
			result.prUrl = hydratedPr.prUrl;
			result.prEvidence = hydratedPr.prEvidence;
		}
	}

	if (reviewSidecarPath) {
		await hydrateReviewSidecar(reviewSidecarPath);
	}
}

export async function executeWithEngine(
	engine: AgentEngine,
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
): Promise<AgentResult> {
	const { workItemId } = input;
	const identifier = `${agentType}-${workItemId || 'unknown'}`;

	return executeAgentPipeline({
		loggerIdentifier: identifier,

		setupRepoDir: (log) => resolveRepoDir(input, log, agentType),

		skipRepoDeletion: Boolean(input.logDir),

		squintDbUrl: input.project.squintDbUrl,

		finalizeRun: (runId, fileLogger, outcome) =>
			finalizeEngineRun(runId, fileLogger, {
				status: outcome.status,
				durationMs: outcome.durationMs,
				success: outcome.success,
				error: outcome.error,
				costUsd: outcome.costUsd,
				prUrl: outcome.prUrl,
				outputSummary: outcome.outputSummary,
			}),

		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: webhook pipeline with sequential guard checks
		execute: async (ctx: PipelineContext) => {
			const { repoDir, fileLogger, logWriter, setRunId } = ctx;
			const log = createAgentLogger(fileLogger);
			const profile = await getAgentProfile(agentType);
			const isGitHubAck = isGitHubAckComment(input);
			const partialInput = await resolvePartialExecutionPlan(
				engine,
				agentType,
				input,
				repoDir,
				logWriter,
				log,
			);

			const { reviewSidecarPath, prSidecarPath, nativeToolRuntimeCleanup } = partialInput;
			const { pushedChangesSidecarPath } = partialInput;

			// Create run record now that we have model and maxIterations
			const runId = await tryCreateRun(
				{
					projectId: input.project.id,
					workItemId: input.workItemId,
					prNumber: input.prNumber as number | undefined,
					agentType,
					engineName: engine.definition.id,
					triggerType: input.triggerType,
				},
				partialInput.model,
				partialInput.maxIterations,
			);
			if (runId) setRunId(runId);

			// Seed session state so GitHub progress updates target the existing ack comment
			if (isGitHubAck) {
				recordInitialComment(input.ackCommentId as number);
			}

			const monitor = createProgressMonitor(
				buildProgressMonitorConfig(
					input,
					agentType,
					logWriter,
					repoDir,
					isGitHubAck,
					engine.definition.id,
					partialInput.model ?? '',
				),
			);

			// Inject the runId into the progress monitor so links point to the specific run
			if (runId && monitor) {
				monitor.setRunId(runId);
			}

			// Inject run link env vars into project secrets for subprocess agents (claude-code/codex)
			if (input.project.runLinksEnabled) {
				partialInput.projectSecrets ??= {};
				const dashboardUrl = getDashboardUrl();
				if (dashboardUrl) {
					partialInput.projectSecrets.CASCADE_RUN_LINKS_ENABLED = 'true';
					partialInput.projectSecrets.CASCADE_DASHBOARD_URL = dashboardUrl;
					partialInput.projectSecrets.CASCADE_ENGINE_LABEL = engine.definition.id;
					partialInput.projectSecrets.CASCADE_MODEL = partialInput.model ?? '';
					partialInput.projectSecrets.CASCADE_PROJECT_ID = input.project.id;
					if (workItemId) {
						partialInput.projectSecrets.CASCADE_WORK_ITEM_ID = workItemId;
					}
					if (runId) {
						partialInput.projectSecrets.CASCADE_RUN_ID = runId;
					}
				}
			}

			const executionPlan: AgentExecutionPlan = {
				...partialInput,
				progressReporter: monitor ?? {
					onIteration: async () => {},
					onToolCall: () => {},
					onText: () => {},
				},
				runId,
				engineLogPath: fileLogger.engineLogPath,
			};

			monitor?.start();
			let result: Awaited<ReturnType<typeof engine.execute>>;
			try {
				result = await engine.execute(executionPlan);
				await hydrateNativeToolSidecars(result, prSidecarPath, reviewSidecarPath);
				const completionEvidence = readCompletionEvidence(executionPlan.completionRequirements);

				postProcessResult(result, agentType, engine, input, identifier, {
					requiresPR: profile.finishHooks.requiresPR,
					requiresReview: profile.finishHooks.requiresReview,
					requiresPushedChanges: profile.finishHooks.requiresPushedChanges,
					hasAuthoritativeReview: completionEvidence.hasAuthoritativeReview,
					hasAuthoritativePushedChanges:
						pushedChangesSidecarPath !== undefined
							? completionEvidence.hasAuthoritativePushedChanges
							: undefined,
				});
			} finally {
				monitor?.stop();
				cleanupTempFile(prSidecarPath);
				cleanupTempFile(reviewSidecarPath);
				cleanupTempFile(pushedChangesSidecarPath);
				nativeToolRuntimeCleanup?.();
			}

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
