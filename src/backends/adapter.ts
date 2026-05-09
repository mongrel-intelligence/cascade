import { getAgentProfile } from '../agents/definitions/profiles.js';
import { BootFailureError } from '../agents/shared/bootFailureError.js';
import { executeAgentPipeline, type PipelineContext } from '../agents/shared/executionPipeline.js';
import { setupRepository } from '../agents/shared/repository.js';
import { finalizeEngineRun, tryUpdateRunPlanResolution } from '../agents/shared/runTracking.js';
import { createAgentLogger } from '../agents/utils/logging.js';
import { recordInitialComment } from '../gadgets/sessionState.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { readCompletionEvidence } from './completion.js';
import { postProcessResult } from './postProcess.js';
import { createProgressMonitor } from './progress.js';
import { buildProgressMonitorConfig, isGitHubAckComment } from './progressLifecycle.js';
import { injectRunLinkSecrets, resolvePartialExecutionPlan } from './secretOrchestrator.js';
import {
	cleanupTempFile,
	drainFrictionSidecarReports,
	hydrateNativeToolSidecars,
} from './sidecarManager.js';
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
		prNumber: input.prNumber,
		prHeadSha: input.headSha,
		prBranch: input.prBranch,
		warmTsCache: true,
	});
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

		// Spec 018: create the run row UPFRONT so any boot-phase failure
		// (template load, plan resolution, context-pipeline assembly) is
		// recorded as a failed run visible in the dashboard. `model` and
		// `maxIterations` are filled in via `tryUpdateRunPlanResolution`
		// after `resolvePartialExecutionPlan` succeeds (deferred-fill).
		runTracking: {
			projectId: input.project.id,
			workItemId: input.workItemId,
			prNumber: input.prNumber as number | undefined,
			agentType,
			engineName: engine.definition.id,
			triggerType: input.triggerType,
		},

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
			const { repoDir, fileLogger, logWriter, runId } = ctx;
			const log = createAgentLogger(fileLogger);
			let profile: Awaited<ReturnType<typeof getAgentProfile>>;
			try {
				profile = await getAgentProfile(agentType);
			} catch (err) {
				throw new BootFailureError('agent definition lookup failed', {
					phase: 'definition-lookup',
					cause: err,
				});
			}
			const isGitHubAck = isGitHubAckComment(input);

			// Spec 018: any failure in `resolvePartialExecutionPlan` (template
			// load, model resolution, context-pipeline assembly) is a boot
			// failure — the run row already exists from `runTracking` above,
			// so we wrap and re-throw as `BootFailureError`. The shared
			// pipeline's catch handler tags Sentry with `worker_boot_failure`
			// and lets the error propagate so the worker exits with code 2.
			let partialInput: Awaited<ReturnType<typeof resolvePartialExecutionPlan>>;
			try {
				partialInput = await resolvePartialExecutionPlan(
					engine,
					agentType,
					input,
					repoDir,
					logWriter,
					log,
				);
			} catch (err) {
				throw new BootFailureError('plan resolution failed', {
					phase: 'plan-resolution',
					cause: err,
				});
			}

			// Plan resolution succeeded — fill in the deferred run-row fields.
			await tryUpdateRunPlanResolution(runId, partialInput.model, partialInput.maxIterations);

			const { reviewSidecarPath, prSidecarPath, frictionSidecarPath, nativeToolRuntimeCleanup } =
				partialInput;
			const { pushedChangesSidecarPath, pmWriteSidecarPath } = partialInput;

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
					profile.lifecycleHooks.syncChecklist ?? false,
				),
			);

			// Inject the runId into the progress monitor so links point to the specific run
			if (runId && monitor) {
				monitor.setRunId(runId);
			}

			// Inject run link env vars into project secrets for subprocess agents (claude-code/codex)
			injectRunLinkSecrets(partialInput, input.project, engine.definition.id, workItemId, runId);

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
			let result: Awaited<ReturnType<typeof engine.execute>> | undefined;
			try {
				if (engine.beforeExecute) {
					await engine.beforeExecute(executionPlan);
				}
				try {
					result = await engine.execute(executionPlan);
				} finally {
					if (engine.afterExecute) {
						// afterExecute always runs; pass result if available (execute() may have thrown).
						await engine.afterExecute(executionPlan, result ?? { success: false, output: '' });
					}
				}
				// biome-ignore lint/style/noNonNullAssertion: result is always defined when execute() did not throw
				await hydrateNativeToolSidecars(result!, prSidecarPath, reviewSidecarPath);
				const completionEvidence = readCompletionEvidence(executionPlan.completionRequirements);

				postProcessResult(result, agentType, engine, input, identifier, {
					requiresPR: profile.finishHooks.requiresPR,
					requiresReview: profile.finishHooks.requiresReview,
					requiresPushedChanges: profile.finishHooks.requiresPushedChanges,
					requiresPMWrite: profile.finishHooks.requiresPMWrite,
					hasAuthoritativeReview: completionEvidence.hasAuthoritativeReview,
					hasAuthoritativePushedChanges:
						pushedChangesSidecarPath !== undefined
							? completionEvidence.hasAuthoritativePushedChanges
							: undefined,
					hasPMWrite: pmWriteSidecarPath !== undefined ? completionEvidence.hasPMWrite : undefined,
				});
			} finally {
				monitor?.stop();
				await drainFrictionSidecarReports({
					sidecarPath: frictionSidecarPath,
					project: input.project,
					agentType,
					runId,
					engineId: engine.definition.id,
				});
				cleanupTempFile(prSidecarPath);
				cleanupTempFile(reviewSidecarPath);
				cleanupTempFile(pushedChangesSidecarPath);
				cleanupTempFile(pmWriteSidecarPath);
				cleanupTempFile(frictionSidecarPath);
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
