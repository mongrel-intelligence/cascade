import fs from 'node:fs';

import { LLMist, type ModelSpec, createLogger } from 'llmist';

import type { ProgressMonitor } from '../../backends/progressMonitor.js';
import {
	type CompleteRunInput,
	type LlmCallRecord,
	storeLlmCallsBulk,
	storeRunLogs,
} from '../../db/repositories/runsRepository.js';
import { addBreadcrumb } from '../../sentry.js';
import type { AgentResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { runAgentLoop } from '../utils/agentLoop.js';
import type { AccumulatedLlmCall } from '../utils/hooks.js';
import { getLogLevel } from '../utils/index.js';
import { createAgentLogger } from '../utils/logging.js';
import { createTrackingContext } from '../utils/tracking.js';
import type { BuilderType } from './builderFactory.js';
import {
	type AgentLogger,
	type FileLogger,
	type FinalizeRunOutcome,
	type PipelineContext,
	executeAgentPipeline,
} from './executionPipeline.js';
import type { RunTrackingInput } from './runTracking.js';
import { tryCompleteRun, tryCreateRun } from './runTracking.js';

export type { FileLogger, AgentLogger };

export interface BaseAgentContext {
	model: string;
	maxIterations: number;
	prompt: string;
}

export interface ExecuteAgentOptions<TContext extends BaseAgentContext> {
	/** Identifier for log file naming (e.g., "review-42", "ci-42") */
	loggerIdentifier: string;

	/** Called when the watchdog timer expires. FileLogger is already closed. */
	onWatchdogTimeout: (fileLogger: FileLogger, runId?: string) => Promise<void>;

	/** Set up the working directory (clone repo, etc.) */
	setupRepoDir: (log: AgentLogger) => Promise<string>;

	/** Build agent-specific context (model config, PR data, etc.) */
	buildContext: (repoDir: string, log: AgentLogger) => Promise<TContext>;

	/** Create the configured agent builder with gadgets */
	createBuilder: (params: {
		client: LLMist;
		ctx: TContext;
		llmistLogger: ReturnType<typeof createLogger>;
		trackingContext: ReturnType<typeof createTrackingContext>;
		fileLogger: FileLogger;
		repoDir: string;
		progressMonitor: ProgressMonitor | null;
		llmCallAccumulator: AccumulatedLlmCall[];
		/** Run ID for real-time LLM call logging (resolved before builder creation) */
		runId: string | undefined;
	}) => BuilderType;

	/** Inject pre-fetched data as synthetic gadget calls */
	injectSyntheticCalls: (params: {
		builder: BuilderType;
		ctx: TContext;
		trackingContext: ReturnType<typeof createTrackingContext>;
		repoDir: string;
	}) => Promise<BuilderType>;

	/** Create a ProgressMonitor for time-based progress reporting */
	createProgressMonitor?: (fileLogger: FileLogger, repoDir: string) => ProgressMonitor | null;

	/** Whether to run in interactive mode */
	interactive?: boolean;

	/** Whether to auto-accept gadget calls */
	autoAccept?: boolean;

	/** Custom model definitions for LLMist */
	customModels?: ModelSpec[];

	/** Extract additional fields from agent output (e.g., PR URL) */
	postProcess?: (output: string) => Partial<AgentResult>;

	/** Run tracking configuration (if set, creates DB records) */
	runTracking?: RunTrackingInput;

	/** Remote Squint DB URL for projects that don't commit .squint.db */
	squintDbUrl?: string;
}

// ============================================================================
// Run Tracking Helpers
// ============================================================================

async function tryStoreLogsAndCalls(
	runId: string,
	fileLogger: FileLogger,
	llmCallAccumulator: AccumulatedLlmCall[],
	realtimeLoggingActive?: boolean,
): Promise<void> {
	try {
		// Read log files from disk
		const cascadeLog = fs.existsSync(fileLogger.logPath)
			? fs.readFileSync(fileLogger.logPath, 'utf-8')
			: undefined;
		const llmistLog = fs.existsSync(fileLogger.llmistLogPath)
			? fs.readFileSync(fileLogger.llmistLogPath, 'utf-8')
			: undefined;

		await storeRunLogs(runId, cascadeLog, llmistLog);

		// Merge file-based request/response text with accumulator-based token/cost metrics
		const llmLogFiles = fileLogger.llmCallLogger.getLogFiles();
		const requestFiles = new Map<number, string>();
		const responseFiles = new Map<number, string>();

		for (const filePath of llmLogFiles) {
			const basename = filePath.split('/').pop() ?? '';
			const match = basename.match(/^(\d+)\.(request|response)$/);
			if (!match) continue;
			const callNum = Number.parseInt(match[1], 10);
			const content = fs.readFileSync(filePath, 'utf-8');
			if (match[2] === 'request') {
				requestFiles.set(callNum, content);
			} else {
				responseFiles.set(callNum, content);
			}
		}

		// Build LLM call records by merging file content with accumulator metrics
		const accumulatorMap = new Map<number, AccumulatedLlmCall>();
		for (const acc of llmCallAccumulator) {
			accumulatorMap.set(acc.callNumber, acc);
		}

		const allCallNumbers = new Set([
			...requestFiles.keys(),
			...responseFiles.keys(),
			...accumulatorMap.keys(),
		]);

		const calls: LlmCallRecord[] = [];
		for (const callNumber of allCallNumbers) {
			const acc = accumulatorMap.get(callNumber);
			calls.push({
				runId,
				callNumber,
				request: requestFiles.get(callNumber),
				response: responseFiles.get(callNumber),
				inputTokens: acc?.inputTokens,
				outputTokens: acc?.outputTokens,
				cachedTokens: acc?.cachedTokens,
				costUsd: acc?.costUsd,
				durationMs: acc?.durationMs,
				model: acc?.model,
			});
		}

		// Skip bulk insert if real-time logging was active (calls already stored per-turn)
		if (calls.length > 0 && !realtimeLoggingActive) {
			await storeLlmCallsBulk(calls);
		}
	} catch (err) {
		logger.warn('Failed to store run logs', { runId, error: String(err) });
	}
}

async function finalizeRunWithLlmCalls(
	runId: string | undefined,
	fileLogger: FileLogger,
	llmCallAccumulator: AccumulatedLlmCall[],
	input: CompleteRunInput,
	realtimeLoggingActive?: boolean,
): Promise<void> {
	if (!runId) return;
	await tryStoreLogsAndCalls(runId, fileLogger, llmCallAccumulator, realtimeLoggingActive);
	await tryCompleteRun(runId, input);
}

// ============================================================================
// Main Lifecycle
// ============================================================================

/**
 * Shared agent execution lifecycle handling logger setup, watchdog,
 * repository setup, LLMist agent creation, execution, and cleanup.
 */
export async function executeAgentLifecycle<TContext extends BaseAgentContext>(
	options: ExecuteAgentOptions<TContext>,
): Promise<AgentResult> {
	const llmCallAccumulator: AccumulatedLlmCall[] = [];

	// Build the finalizeRun callback with access to llmCallAccumulator
	const buildFinalizeRun =
		(finalizeRunFn: typeof finalizeRunWithLlmCalls) =>
		async (
			runId: string | undefined,
			fileLogger: FileLogger,
			outcome: FinalizeRunOutcome,
		): Promise<void> => {
			const meta = outcome.metadata as { llmIterations?: number; gadgetCalls?: number } | undefined;

			const completeInput: CompleteRunInput = {
				status: outcome.status,
				durationMs: outcome.durationMs,
				success: outcome.success,
				error: outcome.error,
				costUsd: outcome.costUsd,
				prUrl: outcome.prUrl,
				outputSummary: outcome.outputSummary,
				llmIterations: meta?.llmIterations,
				gadgetCalls: meta?.gadgetCalls,
			};
			await finalizeRunFn(runId, fileLogger, llmCallAccumulator, completeInput, !!runId);
		};

	return executeAgentPipeline({
		loggerIdentifier: options.loggerIdentifier,
		setupRepoDir: options.setupRepoDir,
		squintDbUrl: options.squintDbUrl,

		onWatchdogTimeout: async (fileLogger, runId) => {
			await options.onWatchdogTimeout(fileLogger, runId);
		},

		finalizeRun: buildFinalizeRun(finalizeRunWithLlmCalls),

		execute: async (ctx: PipelineContext) => {
			const { repoDir, fileLogger, setRunId } = ctx;

			const log = createAgentLogger(fileLogger);
			const ctx_ = await options.buildContext(repoDir, log);

			// Create run record now that we have model and maxIterations
			let runId: string | undefined;
			if (options.runTracking) {
				runId = await tryCreateRun(options.runTracking, ctx_.model, ctx_.maxIterations);
				if (runId) setRunId(runId);
			}

			log.info('Starting llmist agent', {
				model: ctx_.model,
				maxIterations: ctx_.maxIterations,
				promptLength: ctx_.prompt.length,
				runId,
			});

			addBreadcrumb({
				category: 'agent',
				message: `Starting ${options.loggerIdentifier}`,
				data: { model: ctx_.model, maxIterations: ctx_.maxIterations, runId },
			});

			process.env.LLMIST_LOG_FILE = fileLogger.llmistLogPath;
			process.env.LLMIST_LOG_TEE = 'true';

			const client = options.customModels
				? new LLMist({ customModels: options.customModels })
				: new LLMist();
			const llmistLogger = createLogger({ minLevel: getLogLevel() });
			const trackingContext = createTrackingContext();
			const progressMonitor = options.createProgressMonitor?.(fileLogger, repoDir) ?? null;

			let builder = options.createBuilder({
				client,
				ctx: ctx_,
				llmistLogger,
				trackingContext,
				fileLogger,
				repoDir,
				progressMonitor,
				llmCallAccumulator,
				runId,
			});
			builder = await options.injectSyntheticCalls({
				builder,
				ctx: ctx_,
				trackingContext,
				repoDir,
			});

			const agent = builder.ask(ctx_.prompt);

			progressMonitor?.start();
			let result: Awaited<ReturnType<typeof runAgentLoop>>;
			try {
				result = await runAgentLoop(
					agent,
					log,
					trackingContext,
					options.interactive === true,
					options.autoAccept === true,
				);
			} finally {
				progressMonitor?.stop();
			}

			log.info('Agent completed', {
				iterations: result.iterations,
				gadgetCalls: result.gadgetCalls,
				cost: result.cost,
				loopTerminated: result.loopTerminated ?? false,
			});

			return {
				success: !result.loopTerminated,
				output: result.output,
				error: result.loopTerminated ? 'Agent terminated due to persistent loop' : undefined,
				cost: result.cost,
				prUrl: options.postProcess?.(result.output)?.prUrl,
				finalizeMetadata: {
					llmIterations: result.iterations,
					gadgetCalls: result.gadgetCalls,
				},
			};
		},
	});
}
