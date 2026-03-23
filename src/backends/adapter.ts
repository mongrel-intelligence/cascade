import { getAgentProfile } from '../agents/definitions/profiles.js';
import { type PipelineContext, executeAgentPipeline } from '../agents/shared/executionPipeline.js';
import { setupRepository } from '../agents/shared/repository.js';
import { finalizeEngineRun, tryCreateRun } from '../agents/shared/runTracking.js';
import { createAgentLogger } from '../agents/utils/logging.js';
import { recordInitialComment } from '../gadgets/sessionState.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { readCompletionEvidence } from './completion.js';
import { postProcessResult } from './postProcess.js';
import { createProgressMonitor } from './progress.js';
import { buildProgressMonitorConfig, isGitHubAckComment } from './progressLifecycle.js';
import { injectRunLinkSecrets, resolvePartialExecutionPlan } from './secretOrchestrator.js';
import { cleanupTempFile, hydrateNativeToolSidecars } from './sidecarManager.js';
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
			const { pushedChangesSidecarPath, pmWriteSidecarPath } = partialInput;

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
				cleanupTempFile(prSidecarPath);
				cleanupTempFile(reviewSidecarPath);
				cleanupTempFile(pushedChangesSidecarPath);
				cleanupTempFile(pmWriteSidecarPath);
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
