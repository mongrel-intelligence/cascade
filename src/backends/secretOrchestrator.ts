import { needsGitStateStopHooks } from '../agents/definitions/index.js';
import { getAgentProfile } from '../agents/definitions/profiles.js';
import { getToolManifests } from '../agents/definitions/toolManifests.js';
import type { PromptContext } from '../agents/prompts/index.js';
import type { LogWriter } from '../agents/shared/executionPipeline.js';
import { resolveModelConfig } from '../agents/shared/modelResolution.js';
import { buildPromptContext } from '../agents/shared/promptContext.js';
import type { createAgentLogger } from '../agents/utils/logging.js';
import { mergeEngineSettings } from '../config/engineSettings.js';
import { loadPartials } from '../db/repositories/partialsRepository.js';
import { withGitHubToken } from '../github/client.js';
import type { AgentInput, CascadeConfig, ProjectConfig } from '../types/index.js';
import { getDashboardUrl } from '../utils/runLink.js';
import { createNativeToolRuntimeArtifacts } from './nativeToolRuntime.js';
import { isGitHubAckComment } from './progressLifecycle.js';
import {
	augmentProjectSecrets,
	injectGitHubAckCommentId,
	injectProgressCommentId,
	resolveGitHubToken,
} from './secretBuilder.js';
import { createCompletionArtifacts } from './sidecarManager.js';
import type { AgentEngine, AgentExecutionPlan } from './types.js';

/**
 * Build the execution plan by resolving model config, fetching context, etc.
 * Uses agent profiles to customize tools, context, and prompts per agent type.
 */
export async function buildExecutionPlan(
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
	repoDir: string,
	logWriter: LogWriter,
	_log: ReturnType<typeof createAgentLogger>,
	gitHubToken: string | undefined,
	isGitHubAck: boolean,
	engineId: string,
	engine: AgentEngine,
): Promise<
	Omit<AgentExecutionPlan, 'progressReporter'> & {
		reviewSidecarPath?: string;
		prSidecarPath?: string;
		pushedChangesSidecarPath?: string;
		pmWriteSidecarPath?: string;
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
		undefined,
		repoDir,
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
		model: rawModel,
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

	// Allow the engine to resolve/validate the model string (e.g. strip provider prefix)
	const model = engine.resolveModel ? engine.resolveModel(rawModel) : rawModel;

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

	const { reviewSidecarPath, prSidecarPath, pushedChangesSidecarPath, pmWriteSidecarPath } =
		createCompletionArtifacts(profile, agentType, needsNativeToolRuntime, input, projectSecrets);

	const completionRequirements = {
		requiresPR: profile.finishHooks.requiresPR,
		requiresReview: profile.finishHooks.requiresReview,
		requiresPushedChanges: profile.finishHooks.requiresPushedChanges,
		requiresPMWrite: profile.finishHooks.requiresPMWrite,
		prSidecarPath,
		reviewSidecarPath,
		pushedChangesSidecarPath,
		pmWriteSidecarPath,
		maxContinuationTurns: 2,
	};

	// Override GITHUB_TOKEN in subprocess secrets with agent-scoped token
	if (gitHubToken && profile.needsGitHubToken) {
		projectSecrets.GITHUB_TOKEN = gitHubToken;
	}

	// Merge engine settings: agent-config settings override project-level settings.
	// When no per-agent settings exist for this agent type, project-level settings are used unchanged.
	const agentLevelEngineSettings = project.agentEngineSettings?.[agentType];
	const mergedEngineSettings = mergeEngineSettings(
		project.engineSettings,
		agentLevelEngineSettings,
	);

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
		engineSettings: mergedEngineSettings,
		...(Object.keys(projectSecrets).length > 0 && { projectSecrets }),
		reviewSidecarPath,
		prSidecarPath,
		pushedChangesSidecarPath,
		pmWriteSidecarPath,
		nativeToolRuntimeCleanup: nativeToolRuntime?.cleanup,
	};
}

/**
 * Resolve the partial execution plan including GitHub token resolution and
 * all project secret injection. Wraps buildExecutionPlan with token handling.
 */
export async function resolvePartialExecutionPlan(
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
			engine,
		);

	const partialInput = gitHubToken
		? await withGitHubToken(gitHubToken, buildPartial)
		: await buildPartial();

	return partialInput;
}

/**
 * Inject run-link env vars into project secrets for subprocess agents.
 * Called after the run ID is known so it can be included in the secrets.
 */
export function injectRunLinkSecrets(
	partialInput: { projectSecrets?: Record<string, string>; model?: string },
	project: ProjectConfig,
	engineId: string,
	workItemId: string | undefined,
	runId: string | undefined,
): void {
	if (!project.runLinksEnabled) return;

	const dashboardUrl = getDashboardUrl();
	if (!dashboardUrl) return;

	partialInput.projectSecrets ??= {};
	partialInput.projectSecrets.CASCADE_RUN_LINKS_ENABLED = 'true';
	partialInput.projectSecrets.CASCADE_DASHBOARD_URL = dashboardUrl;
	partialInput.projectSecrets.CASCADE_ENGINE_LABEL = engineId;
	partialInput.projectSecrets.CASCADE_MODEL = partialInput.model ?? '';
	partialInput.projectSecrets.CASCADE_PROJECT_ID = project.id;
	if (workItemId) {
		partialInput.projectSecrets.CASCADE_WORK_ITEM_ID = workItemId;
	}
	if (runId) {
		partialInput.projectSecrets.CASCADE_RUN_ID = runId;
	}
}
