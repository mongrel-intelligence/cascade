import type { ModelSpec } from 'llmist';

import { createAgentLogger } from '../agents/utils/logging.js';
import { CUSTOM_MODELS } from '../config/customModels.js';
import { getAgentCredential, getProjectSecrets } from '../config/provider.js';
import { withGitHubToken } from '../github/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { loadCascadeEnv, unloadCascadeEnv } from '../utils/cascadeEnv.js';
import { cleanupLogDirectory, cleanupLogFile, createFileLogger } from '../utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../utils/lifecycle.js';
import { logger } from '../utils/logging.js';
import { cleanupTempDir } from '../utils/repo.js';
import { getAgentProfile } from './agent-profiles.js';
import { buildBackendContext } from './context/injection.js';
import { createProgressMonitor } from './progress.js';
import { resolveRepoDir } from './repository/manager.js';
import { getToolManifests } from './tools/manifests.js';
import {
	finalizeBackendRun,
	postProcessResult,
	tryCreateBackendRun,
} from './tracking/runTracker.js';
import type { AgentBackend, AgentBackendInput, LogWriter } from './types.js';

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
 * Clean up temporary resources after execution.
 */
function cleanupResources(
	repoDir: string | null,
	fileLogger: ReturnType<typeof createFileLogger>,
	hasLogDir: boolean,
): void {
	clearWatchdogCleanup();

	const isLocalMode = process.env.CASCADE_LOCAL_MODE === 'true';

	if (repoDir && !isLocalMode && !hasLogDir) {
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

/**
 * Resolve the GitHub token for profiles that need GitHub client access.
 * Uses agent-scoped override if available, otherwise falls back to project secrets.
 */
async function resolveGitHubToken(
	profile: ReturnType<typeof getAgentProfile>,
	projectId: string,
	agentType: string,
): Promise<string | undefined> {
	if (!profile.needsGitHubToken) return undefined;

	const agentToken = await getAgentCredential(projectId, agentType, 'GITHUB_TOKEN');
	if (agentToken) return agentToken;

	const secrets = await getProjectSecrets(projectId);
	return secrets.GITHUB_TOKEN;
}

/**
 * Execute an agent using the given backend with full lifecycle management.
 * This handles repository setup, context fetching, logging, and cleanup.
 *
 * Used by non-llmist backends. The llmist backend wraps existing code directly.
 */
export async function executeWithBackend(
	backend: AgentBackend,
	agentType: string,
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig },
): Promise<AgentResult> {
	const { cardId, project } = input;
	let repoDir: string | null = null;
	let runId: string | undefined;
	const startTime = Date.now();

	const identifier = `${agentType}-${cardId || 'unknown'}`;
	const fileLogger = createFileLogger(`cascade-${identifier}`);
	const log = createAgentLogger(fileLogger);

	setWatchdogCleanup(async () => {
		fileLogger.close();
		await finalizeBackendRun(runId, fileLogger.logPath, fileLogger.llmistLogPath, {
			status: 'timed_out',
			durationMs: Date.now() - startTime,
			success: false,
			error: 'Watchdog timeout',
		});
	});

	try {
		repoDir = await resolveRepoDir(input, log, agentType);
		const envSnapshot = loadCascadeEnv(repoDir, log);
		const logWriter = createLogWriter(fileLogger);

		const profile = getAgentProfile(agentType);
		const gitHubToken = await resolveGitHubToken(profile, project.id, agentType);

		// Build backend context and run pre-execute, wrapped in GitHub token scope if needed
		const resolvedRepoDir = repoDir;
		const buildAndPrepare = async () => {
			const context = await buildBackendContext({
				agentType,
				input,
				repoDir: resolvedRepoDir,
				logWriter,
				availableTools: getToolManifests(),
			});

			const cliToolsDir = new URL('../../bin', import.meta.url).pathname;

			// Resolve all per-project secrets for subprocess injection
			let projectSecrets = await getProjectSecrets(project.id);

			// Override GITHUB_TOKEN in subprocess secrets with agent-scoped token
			if (gitHubToken && profile.needsGitHubToken) {
				projectSecrets = {
					...projectSecrets,
					GITHUB_TOKEN: gitHubToken,
				};
			}

			// Pre-execute hook (e.g., post initial PR comment for review)
			if (profile.preExecute) {
				await profile.preExecute({ input, logWriter });
			}

			return {
				agentType,
				project,
				config: input.config,
				repoDir: resolvedRepoDir,
				systemPrompt: context.systemPrompt,
				taskPrompt: context.taskPrompt,
				cliToolsDir,
				availableTools: context.filteredTools,
				contextInjections: context.contextInjections,
				maxIterations: context.maxIterations,
				budgetUsd: input.remainingBudgetUsd as number | undefined,
				model: context.model,
				logWriter,
				agentInput: input,
				sdkTools: context.sdkTools,
				enableStopHooks: context.enableStopHooks,
				...(Object.keys(projectSecrets).length > 0 && { projectSecrets }),
			};
		};

		const partialInput = gitHubToken
			? await withGitHubToken(gitHubToken, buildAndPrepare)
			: await buildAndPrepare();

		runId = await tryCreateBackendRun(
			agentType,
			backend.name,
			project.id,
			cardId,
			input.prNumber,
			input.triggerType,
			partialInput.model,
			partialInput.maxIterations,
		);

		const monitor = createProgressMonitor({
			logWriter,
			agentType,
			taskDescription: cardId ? `Work item ${cardId}` : 'Unknown task',
			progressModel: input.config.defaults.progressModel,
			intervalMinutes: input.config.defaults.progressIntervalMinutes,
			customModels: CUSTOM_MODELS as ModelSpec[],
			trello: cardId ? { cardId } : undefined,
		});

		const backendInput: AgentBackendInput = {
			...partialInput,
			progressReporter: monitor ?? {
				onIteration: async () => {},
				onToolCall: () => {},
				onText: () => {},
			},
		};

		const originalCwd = process.cwd();
		process.chdir(repoDir);
		monitor?.start();

		try {
			const result = await backend.execute(backendInput);
			postProcessResult(
				result,
				agentType,
				backend,
				project.id,
				project.agentBackend?.subscriptionCostZero ?? false,
				identifier,
			);

			fileLogger.close();
			const logBuffer = await fileLogger.getZippedBuffer();

			await finalizeBackendRun(runId, fileLogger.logPath, fileLogger.llmistLogPath, {
				status: result.success ? 'completed' : 'failed',
				durationMs: Date.now() - startTime,
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
				error: result.error,
				cost: result.cost,
				logBuffer: logBuffer ?? result.logBuffer,
				runId,
			};
		} finally {
			monitor?.stop();
			process.chdir(originalCwd);
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

		await finalizeBackendRun(runId, fileLogger.logPath, fileLogger.llmistLogPath, {
			status: 'failed',
			durationMs: Date.now() - startTime,
			success: false,
			error: String(err),
		});

		return { success: false, output: '', error: String(err), logBuffer, runId };
	} finally {
		cleanupResources(repoDir, fileLogger, Boolean(input.logDir));
	}
}
