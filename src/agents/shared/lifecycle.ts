import fs from 'node:fs';
import { LLMist, type ModelSpec, createLogger } from 'llmist';

import type { ProgressMonitor } from '../../backends/progressMonitor.js';
import {
	type CompleteRunInput,
	type LlmCallRecord,
	storeLlmCallsBulk,
	storeRunLogs,
} from '../../db/repositories/runsRepository.js';
import type { AgentResult } from '../../types/index.js';
import { loadCascadeEnv, unloadCascadeEnv } from '../../utils/cascadeEnv.js';
import { createFileLogger } from '../../utils/fileLogger.js';
import { setWatchdogCleanup } from '../../utils/lifecycle.js';
import { logger } from '../../utils/logging.js';
import { setupRemoteSquintDb } from '../../utils/squintDb.js';
import { runAgentLoop } from '../utils/agentLoop.js';
import type { AccumulatedLlmCall } from '../utils/hooks.js';
import { getLogLevel } from '../utils/index.js';
import { createAgentLogger } from '../utils/logging.js';
import { type TrackingContext, createTrackingContext } from '../utils/tracking.js';
import type { BuilderType } from './builderFactory.js';
import { cleanupAgentResources } from './cleanup.js';
import { type RunTrackingInput, tryCompleteRun, tryCreateRun } from './runTracking.js';

type FileLogger = ReturnType<typeof createFileLogger>;
type AgentLogger = ReturnType<typeof createAgentLogger>;

export type { FileLogger, AgentLogger };

export interface BaseAgentContext {
	model: string;
	maxIterations: number;
	prompt: string;
}

/** @deprecated Use RunTrackingInput from runTracking.ts */
export type RunTrackingConfig = RunTrackingInput;

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
		trackingContext: TrackingContext;
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
		trackingContext: TrackingContext;
		repoDir: string;
	}) => Promise<BuilderType>;

	/** Create a ProgressMonitor for time-based progress reporting */
	createProgressMonitor?: (fileLogger: FileLogger) => ProgressMonitor | null;

	/** Whether to run in interactive mode */
	interactive?: boolean;

	/** Whether to auto-accept gadget calls */
	autoAccept?: boolean;

	/** Custom model definitions for LLMist */
	customModels?: ModelSpec[];

	/** Extract additional fields from agent output (e.g., PR URL) */
	postProcess?: (output: string) => Partial<AgentResult>;

	/** Run tracking configuration (if set, creates DB records) */
	runTracking?: RunTrackingConfig;

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

// ============================================================================
// Run Finalization Helper
// ============================================================================

async function finalizeRun(
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

function buildAgentResult(
	result: Awaited<ReturnType<typeof runAgentLoop>>,
	logBuffer: Buffer,
	runId: string | undefined,
	durationMs: number,
	postProcess?: (output: string) => Partial<AgentResult>,
): AgentResult {
	if (result.loopTerminated) {
		return {
			success: false,
			output: result.output,
			error: 'Agent terminated due to persistent loop',
			logBuffer,
			cost: result.cost,
			runId,
			durationMs,
		};
	}

	const postProcessed = postProcess?.(result.output) ?? {};
	return {
		success: true,
		output: result.output,
		logBuffer,
		cost: result.cost,
		runId,
		durationMs,
		...postProcessed,
	};
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
	let repoDir: string | null = null;
	let runId: string | undefined;
	const startTime = Date.now();
	const llmCallAccumulator: AccumulatedLlmCall[] = [];

	const fileLogger = createFileLogger(`cascade-${options.loggerIdentifier}`);
	const log = createAgentLogger(fileLogger);

	setWatchdogCleanup(async () => {
		fileLogger.close();
		await finalizeRun(
			runId,
			fileLogger,
			llmCallAccumulator,
			{
				status: 'timed_out',
				durationMs: Date.now() - startTime,
				success: false,
				error: 'Watchdog timeout',
			},
			!!runId,
		);
		await options.onWatchdogTimeout(fileLogger, runId);
	});

	try {
		repoDir = await options.setupRepoDir(log);
		const envSnapshot = loadCascadeEnv(repoDir, log);
		const squintCleanup = await setupRemoteSquintDb(
			repoDir,
			{ squintDbUrl: options.squintDbUrl },
			log,
		);

		const ctx = await options.buildContext(repoDir, log);

		if (options.runTracking) {
			runId = await tryCreateRun(options.runTracking, ctx.model, ctx.maxIterations);
		}

		const originalCwd = process.cwd();
		process.chdir(repoDir);

		log.info('Starting llmist agent', {
			model: ctx.model,
			maxIterations: ctx.maxIterations,
			promptLength: ctx.prompt.length,
			runId,
		});

		try {
			process.env.LLMIST_LOG_FILE = fileLogger.llmistLogPath;
			process.env.LLMIST_LOG_TEE = 'true';

			const client = options.customModels
				? new LLMist({ customModels: options.customModels })
				: new LLMist();
			const llmistLogger = createLogger({ minLevel: getLogLevel() });
			const trackingContext = createTrackingContext();
			const progressMonitor = options.createProgressMonitor?.(fileLogger) ?? null;

			let builder = options.createBuilder({
				client,
				ctx,
				llmistLogger,
				trackingContext,
				fileLogger,
				repoDir,
				progressMonitor,
				llmCallAccumulator,
				runId,
			});
			builder = await options.injectSyntheticCalls({ builder, ctx, trackingContext, repoDir });

			const agent = builder.ask(ctx.prompt);

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

			fileLogger.close();
			const logBuffer = await fileLogger.getZippedBuffer();

			const completionInput: CompleteRunInput = result.loopTerminated
				? {
						status: 'failed',
						durationMs: Date.now() - startTime,
						llmIterations: result.iterations,
						gadgetCalls: result.gadgetCalls,
						costUsd: result.cost,
						success: false,
						error: 'Agent terminated due to persistent loop',
						outputSummary: result.output.slice(0, 500),
					}
				: {
						status: 'completed',
						durationMs: Date.now() - startTime,
						llmIterations: result.iterations,
						gadgetCalls: result.gadgetCalls,
						costUsd: result.cost,
						success: true,
						prUrl: options.postProcess?.(result.output)?.prUrl,
						outputSummary: result.output.slice(0, 500),
					};

			await finalizeRun(runId, fileLogger, llmCallAccumulator, completionInput, !!runId);

			return buildAgentResult(
				result,
				logBuffer,
				runId,
				Date.now() - startTime,
				options.postProcess,
			);
		} finally {
			process.chdir(originalCwd);
			squintCleanup?.();
			unloadCascadeEnv(envSnapshot);
		}
	} catch (err) {
		logger.error('Agent execution failed', {
			identifier: options.loggerIdentifier,
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
		await finalizeRun(
			runId,
			fileLogger,
			llmCallAccumulator,
			{
				status: 'failed',
				durationMs,
				success: false,
				error: String(err),
			},
			!!runId,
		);

		return { success: false, output: '', error: String(err), logBuffer, runId, durationMs };
	} finally {
		cleanupAgentResources(repoDir, fileLogger);
	}
}
