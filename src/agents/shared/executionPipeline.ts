import { captureException } from '../../sentry.js';
import type { AgentResult } from '../../types/index.js';
import { loadCascadeEnv, unloadCascadeEnv } from '../../utils/cascadeEnv.js';
import { createFileLogger } from '../../utils/fileLogger.js';
import { setWatchdogCleanup } from '../../utils/lifecycle.js';
import { logger } from '../../utils/logging.js';
import { setupRemoteSquintDb } from '../../utils/squintDb.js';
import { createAgentLogger } from '../utils/logging.js';
import { cleanupAgentResources } from './cleanup.js';
import type { RunTrackingInput } from './runTracking.js';
import { tryCreateRun } from './runTracking.js';

export type FileLogger = ReturnType<typeof createFileLogger>;
export type AgentLogger = ReturnType<typeof createAgentLogger>;

/**
 * A LogWriter that writes to both the file logger and the structured logger.
 */
export type LogWriter = (level: string, message: string, context?: Record<string, unknown>) => void;

/**
 * Creates a LogWriter that forwards to both the file logger and the structured logger.
 */
export function createLogWriter(fileLogger: FileLogger): LogWriter {
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
 * Context passed to the execute callback.
 */
export interface PipelineContext {
	repoDir: string;
	fileLogger: FileLogger;
	logWriter: LogWriter;
	runId: string | undefined;
	/**
	 * Update the pipeline's runId. Call this when the execute callback creates
	 * the run record itself (e.g., after resolving model/maxIterations).
	 * The updated runId is used for finalizeRun and in the error path.
	 */
	setRunId: (id: string) => void;
}

/**
 * Result returned by the execute callback.
 */
export interface ExecutionResult {
	success: boolean;
	output: string;
	error?: string;
	cost?: number;
	prUrl?: string;
	progressCommentId?: string;
	/** Log buffer from the execution, if available from the execute callback */
	logBuffer?: Buffer;
	/**
	 * Additional metadata to pass to finalizeRun.
	 * Useful for backend-specific finalization fields (e.g., llmIterations, gadgetCalls).
	 */
	finalizeMetadata?: Record<string, unknown>;
}

/**
 * Options for the shared agent execution pipeline.
 */
export interface AgentPipelineOptions {
	/**
	 * Identifier for log file naming (e.g., "review-42", "ci-42").
	 */
	loggerIdentifier: string;

	/**
	 * Set up the working directory (clone repo, etc.).
	 */
	setupRepoDir: (log: AgentLogger) => Promise<string>;

	/**
	 * Run tracking configuration. When set, creates a DB run record before execution.
	 */
	runTracking?: RunTrackingInput & { model?: string; maxIterations?: number };

	/**
	 * Remote Squint DB URL for projects that don't commit .squint.db.
	 */
	squintDbUrl?: string;

	/**
	 * Whether the repoDir was pre-existing (skip deletion on cleanup).
	 * When true, skips temp dir deletion in cleanup.
	 */
	skipRepoDeletion?: boolean;

	/**
	 * The backend-specific execution step.
	 * Receives the pipeline context and returns the execution result.
	 * The pipeline handles CWD change/restore around this callback.
	 */
	execute: (ctx: PipelineContext) => Promise<ExecutionResult>;

	/**
	 * Called when the watchdog timer expires.
	 * FileLogger is already closed when this is invoked.
	 * Runs inside the watchdog cleanup — keep it fast and non-throwing.
	 */
	onWatchdogTimeout?: (fileLogger: FileLogger, runId?: string) => Promise<void>;

	/**
	 * Finalize the run record (store logs, mark complete).
	 * Called with the outcome of execution (success or error).
	 */
	finalizeRun: (
		runId: string | undefined,
		fileLogger: FileLogger,
		outcome: FinalizeRunOutcome,
	) => Promise<void>;
}

/**
 * Outcome passed to finalizeRun.
 */
export interface FinalizeRunOutcome {
	status: 'completed' | 'failed' | 'timed_out';
	durationMs: number;
	success: boolean;
	error?: string;
	costUsd?: number;
	prUrl?: string;
	outputSummary?: string;
	/** Additional backend-specific metadata (e.g., llmIterations, gadgetCalls for llmist) */
	metadata?: Record<string, unknown>;
}

/**
 * Shared agent execution scaffold used by both the llmist lifecycle and
 * the Claude Code backend adapter.
 *
 * Handles: FileLogger → Watchdog → Repo setup → Env snapshot → Squint DB →
 * Run tracking → CWD change → Execute → Restore CWD → Finalize run → Cleanup.
 *
 * The only divergent step is the `execute` callback.
 */
export async function executeAgentPipeline(options: AgentPipelineOptions): Promise<AgentResult> {
	let repoDir: string | null = null;
	let runId: string | undefined;
	const startTime = Date.now();

	const fileLogger = createFileLogger(`cascade-${options.loggerIdentifier}`);
	const log = createAgentLogger(fileLogger);
	const logWriter = createLogWriter(fileLogger);

	setWatchdogCleanup(async () => {
		const durationMs = Date.now() - startTime;
		captureException(new Error('Agent watchdog timeout'), {
			tags: { source: 'watchdog_timeout', agent: options.loggerIdentifier },
			extra: { runId, durationMs },
		});
		fileLogger.close();
		await options.finalizeRun(runId, fileLogger, {
			status: 'timed_out',
			durationMs,
			success: false,
			error: 'Watchdog timeout',
		});
		await options.onWatchdogTimeout?.(fileLogger, runId);
	});

	try {
		repoDir = await options.setupRepoDir(log);
		const envSnapshot = loadCascadeEnv(repoDir, log);
		const squintCleanup = await setupRemoteSquintDb(
			repoDir,
			{ squintDbUrl: options.squintDbUrl },
			log,
		);

		if (options.runTracking) {
			runId = await tryCreateRun(
				options.runTracking,
				options.runTracking.model,
				options.runTracking.maxIterations,
			);
		}

		const originalCwd = process.cwd();
		process.chdir(repoDir);

		let result: ExecutionResult;
		try {
			result = await options.execute({
				repoDir,
				fileLogger,
				logWriter,
				runId,
				setRunId: (id) => {
					runId = id;
				},
			});
		} finally {
			process.chdir(originalCwd);
			squintCleanup?.();
			unloadCascadeEnv(envSnapshot);
		}

		// runId may have been updated by setRunId() inside execute
		const effectiveRunId = runId;

		fileLogger.close();
		const logBuffer = result.logBuffer ?? (await fileLogger.getZippedBuffer());

		const durationMs = Date.now() - startTime;
		await options.finalizeRun(effectiveRunId, fileLogger, {
			status: result.success ? 'completed' : 'failed',
			durationMs,
			success: result.success,
			error: result.error,
			costUsd: result.cost,
			prUrl: result.prUrl,
			outputSummary: result.output.slice(0, 500),
			metadata: result.finalizeMetadata,
		});

		return {
			success: result.success,
			output: result.output,
			prUrl: result.prUrl,
			progressCommentId: result.progressCommentId,
			error: result.error,
			cost: result.cost,
			logBuffer: logBuffer ?? undefined,
			runId: effectiveRunId,
			durationMs,
		};
	} catch (err) {
		logger.error('Agent execution failed', {
			identifier: options.loggerIdentifier,
			error: String(err),
		});
		captureException(err, {
			tags: { source: 'agent_execution', agent: options.loggerIdentifier },
			extra: { runId, durationMs: Date.now() - startTime },
		});

		let logBuffer: Buffer | undefined;
		try {
			fileLogger.close();
			logBuffer = await fileLogger.getZippedBuffer();
		} catch {
			// Ignore log buffer errors
		}

		const durationMs = Date.now() - startTime;
		await options.finalizeRun(runId, fileLogger, {
			status: 'failed',
			durationMs,
			success: false,
			error: String(err),
		});

		return { success: false, output: '', error: String(err), logBuffer, runId, durationMs };
	} finally {
		cleanupAgentResources(repoDir, fileLogger, options.skipRepoDeletion ?? false);
	}
}
