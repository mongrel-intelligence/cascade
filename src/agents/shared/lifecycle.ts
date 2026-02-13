import { LLMist, type ModelSpec, createLogger } from 'llmist';

import type { AgentResult } from '../../types/index.js';
import { cleanupLogDirectory, cleanupLogFile, createFileLogger } from '../../utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../../utils/lifecycle.js';
import { logger } from '../../utils/logging.js';
import { cleanupTempDir } from '../../utils/repo.js';
import { runAgentLoop } from '../utils/agentLoop.js';
import { getLogLevel } from '../utils/index.js';
import { createAgentLogger } from '../utils/logging.js';
import { type TrackingContext, createTrackingContext } from '../utils/tracking.js';
import type { BuilderType } from './builderFactory.js';

type FileLogger = ReturnType<typeof createFileLogger>;
type AgentLogger = ReturnType<typeof createAgentLogger>;

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
	onWatchdogTimeout: (fileLogger: FileLogger) => Promise<void>;

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
	}) => BuilderType;

	/** Inject pre-fetched data as synthetic gadget calls */
	injectSyntheticCalls: (params: {
		builder: BuilderType;
		ctx: TContext;
		trackingContext: TrackingContext;
		repoDir: string;
	}) => Promise<BuilderType>;

	/** Whether to run in interactive mode */
	interactive?: boolean;

	/** Whether to auto-accept gadget calls */
	autoAccept?: boolean;

	/** Custom model definitions for LLMist */
	customModels?: ModelSpec[];

	/** Extract additional fields from agent output (e.g., PR URL) */
	postProcess?: (output: string) => Partial<AgentResult>;
}

/**
 * Shared agent execution lifecycle handling logger setup, watchdog,
 * repository setup, LLMist agent creation, execution, and cleanup.
 */
export async function executeAgentLifecycle<TContext extends BaseAgentContext>(
	options: ExecuteAgentOptions<TContext>,
): Promise<AgentResult> {
	let repoDir: string | null = null;

	const fileLogger = createFileLogger(`cascade-${options.loggerIdentifier}`);
	const log = createAgentLogger(fileLogger);

	setWatchdogCleanup(async () => {
		fileLogger.close();
		await options.onWatchdogTimeout(fileLogger);
	});

	try {
		repoDir = await options.setupRepoDir(log);

		const ctx = await options.buildContext(repoDir, log);

		const originalCwd = process.cwd();
		process.chdir(repoDir);

		log.info('Starting llmist agent', {
			model: ctx.model,
			maxIterations: ctx.maxIterations,
			promptLength: ctx.prompt.length,
		});

		try {
			process.env.LLMIST_LOG_FILE = fileLogger.llmistLogPath;

			const client = options.customModels
				? new LLMist({ customModels: options.customModels })
				: new LLMist();
			const llmistLogger = createLogger({ minLevel: getLogLevel() });
			const trackingContext = createTrackingContext();

			let builder = options.createBuilder({
				client,
				ctx,
				llmistLogger,
				trackingContext,
				fileLogger,
				repoDir,
			});
			builder = await options.injectSyntheticCalls({
				builder,
				ctx,
				trackingContext,
				repoDir,
			});

			const agent = builder.ask(ctx.prompt);
			const result = await runAgentLoop(
				agent,
				log,
				trackingContext,
				options.interactive === true,
				options.autoAccept === true,
			);

			log.info('Agent completed', {
				iterations: result.iterations,
				gadgetCalls: result.gadgetCalls,
				cost: result.cost,
				loopTerminated: result.loopTerminated ?? false,
			});

			fileLogger.close();
			const logBuffer = await fileLogger.getZippedBuffer();

			if (result.loopTerminated) {
				return {
					success: false,
					output: result.output,
					error: 'Agent terminated due to persistent loop',
					logBuffer,
					cost: result.cost,
				};
			}

			const postProcessed = options.postProcess?.(result.output) ?? {};

			return {
				success: true,
				output: result.output,
				logBuffer,
				cost: result.cost,
				...postProcessed,
			};
		} finally {
			process.chdir(originalCwd);
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

		return {
			success: false,
			output: '',
			error: String(err),
			logBuffer,
		};
	} finally {
		clearWatchdogCleanup();

		const isLocalMode = process.env.CASCADE_LOCAL_MODE === 'true';

		if (repoDir && !isLocalMode) {
			try {
				cleanupTempDir(repoDir);
			} catch (err) {
				logger.warn('Failed to cleanup temp directory', { repoDir, error: String(err) });
			}
		}
		if (!isLocalMode) {
			cleanupLogFile(fileLogger.logPath);
			cleanupLogFile(fileLogger.llmistLogPath);
			cleanupLogDirectory(fileLogger.llmCallLogger.logDir);
		}
	}
}
