import fs from 'node:fs';
import type { ModelSpec } from 'llmist';

import type { PromptContext } from '../agents/prompts/index.js';
import { resolveModelConfig } from '../agents/shared/modelResolution.js';
import { setupRepository } from '../agents/shared/repository.js';
import { createAgentLogger } from '../agents/utils/logging.js';
import { CUSTOM_MODELS } from '../config/customModels.js';
import { getAgentCredential, getProjectSecrets } from '../config/provider.js';
import {
	type CompleteRunInput,
	completeRun,
	createRun,
	storeRunLogs,
} from '../db/repositories/runsRepository.js';
import { withGitHubToken } from '../github/client.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../types/index.js';
import { loadCascadeEnv, unloadCascadeEnv } from '../utils/cascadeEnv.js';
import { cleanupLogDirectory, cleanupLogFile, createFileLogger } from '../utils/fileLogger.js';
import { clearWatchdogCleanup, setWatchdogCleanup } from '../utils/lifecycle.js';
import { logger } from '../utils/logging.js';
import { cleanupTempDir } from '../utils/repo.js';
import { getAgentProfile } from './agent-profiles.js';
import { createProgressMonitor } from './progress.js';
import type { AgentBackend, AgentBackendInput, LogWriter, ToolManifest } from './types.js';

/**
 * Get the CLI tool manifests for CASCADE-specific tools.
 * These describe the tools available via cascade-tools CLI.
 */
function getToolManifests(): ToolManifest[] {
	return [
		{
			name: 'ReadWorkItem',
			description:
				'Read a work item (card/issue) with title, description, comments, checklists, and attachments.',
			cliCommand: 'cascade-tools pm read-work-item',
			parameters: {
				workItemId: { type: 'string', required: true },
				includeComments: { type: 'boolean', default: true },
			},
		},
		{
			name: 'PostComment',
			description: 'Post a comment to a work item (card/issue).',
			cliCommand: 'cascade-tools pm post-comment',
			parameters: {
				workItemId: { type: 'string', required: true },
				text: { type: 'string', required: true },
			},
		},
		{
			name: 'UpdateWorkItem',
			description: 'Update a work item title, description, or labels.',
			cliCommand: 'cascade-tools pm update-work-item',
			parameters: {
				workItemId: { type: 'string', required: true },
				title: { type: 'string' },
				description: { type: 'string' },
			},
		},
		{
			name: 'CreateWorkItem',
			description: 'Create a new work item (card/issue).',
			cliCommand: 'cascade-tools pm create-work-item',
			parameters: {
				containerId: { type: 'string', required: true },
				title: { type: 'string', required: true },
			},
		},
		{
			name: 'ListWorkItems',
			description: 'List all work items in a container.',
			cliCommand: 'cascade-tools pm list-work-items',
			parameters: { containerId: { type: 'string', required: true } },
		},
		{
			name: 'AddChecklist',
			description: 'Add a checklist with items to a work item.',
			cliCommand: 'cascade-tools pm add-checklist',
			parameters: {
				workItemId: { type: 'string', required: true },
				name: { type: 'string', required: true },
				items: { type: 'array', required: true },
			},
		},
		{
			name: 'UpdateChecklistItem',
			description: 'Update a checklist item state on a work item.',
			cliCommand: 'cascade-tools pm update-checklist-item',
			parameters: {
				workItemId: { type: 'string', required: true },
				checkItemId: { type: 'string', required: true },
				complete: { type: 'boolean' },
			},
		},
		{
			name: 'CreatePR',
			description:
				'Create a GitHub pull request. Handles the full workflow: stages changes, commits, pushes branch to remote, and creates the PR. ALWAYS use this instead of gh pr create or manual git push. If you have already committed your changes, use --no-commit to skip the commit step.',
			cliCommand: 'cascade-tools github create-pr',
			parameters: {
				title: { type: 'string', required: true },
				body: { type: 'string', required: true },
				head: { type: 'string', required: true },
				base: { type: 'string', required: true },
				'no-commit': {
					type: 'boolean',
					description: 'Skip staging and committing (use when changes are already committed)',
				},
				draft: { type: 'boolean', description: 'Create as draft PR' },
			},
		},
		{
			name: 'GetPRDetails',
			description: 'Get details about a GitHub pull request.',
			cliCommand: 'cascade-tools github get-pr-details',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'GetPRDiff',
			description: 'Get the unified diff of all file changes in a PR.',
			cliCommand: 'cascade-tools github get-pr-diff',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'GetPRChecks',
			description: 'Get CI check status for a PR.',
			cliCommand: 'cascade-tools github get-pr-checks',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'GetPRComments',
			description: 'Get all review comments on a PR.',
			cliCommand: 'cascade-tools github get-pr-comments',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
			},
		},
		{
			name: 'PostPRComment',
			description: 'Post a comment on a GitHub pull request.',
			cliCommand: 'cascade-tools github post-pr-comment',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
				body: { type: 'string', required: true },
			},
		},
		{
			name: 'UpdatePRComment',
			description: 'Update an existing PR comment.',
			cliCommand: 'cascade-tools github update-pr-comment',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				commentId: { type: 'number', required: true },
				body: { type: 'string', required: true },
			},
		},
		{
			name: 'ReplyToReviewComment',
			description: 'Reply to a review comment on a PR.',
			cliCommand: 'cascade-tools github reply-to-review-comment',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
				commentId: { type: 'number', required: true },
				body: { type: 'string', required: true },
			},
		},
		{
			name: 'CreatePRReview',
			description: 'Submit a code review on a PR.',
			cliCommand: 'cascade-tools github create-pr-review',
			parameters: {
				owner: { type: 'string', required: true },
				repo: { type: 'string', required: true },
				prNumber: { type: 'number', required: true },
				event: { type: 'string', required: true },
				body: { type: 'string', required: true },
			},
		},
		{
			name: 'Finish',
			description: 'Validate and signal session completion.',
			cliCommand: 'cascade-tools session finish',
			parameters: { comment: { type: 'string', required: true } },
		},
	];
}

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
	_backendName?: string,
): Promise<Omit<AgentBackendInput, 'progressReporter'>> {
	const { project, config, cardId } = input;

	const pmType = project.pm?.type ?? 'trello';
	const promptContext: PromptContext = {
		cardId,
		cardUrl: cardId
			? pmType === 'jira' && project.jira
				? `${project.jira.baseUrl}/browse/${cardId}`
				: `https://trello.com/c/${cardId}`
			: undefined,
		projectId: project.id,
		baseBranch: project.baseBranch,
		storiesListId: project.trello?.lists?.stories,
		processedLabelId: project.trello?.labels?.processed,
		pmType,
	};

	const { systemPrompt, model, maxIterations, contextFiles } = await resolveModelConfig({
		agentType,
		project,
		config,
		repoDir,
		promptContext,
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

	// Resolve all per-project secrets for subprocess injection
	const projectSecrets = await getProjectSecrets(project.id);

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
		...(Object.keys(projectSecrets).length > 0 && { projectSecrets }),
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
 * Post-process a backend result: validate PR creation for implementation agents
 * and zero out cost for subscription-backed Claude Code sessions.
 */
function postProcessResult(
	result: Awaited<ReturnType<AgentBackend['execute']>>,
	agentType: string,
	backend: AgentBackend,
	input: AgentInput & { project: ProjectConfig },
	identifier: string,
): void {
	// Validate PR creation for implementation agents
	if (agentType === 'implementation' && result.success && !result.prUrl) {
		logger.warn('Implementation agent completed without creating a PR', {
			identifier,
			backend: backend.name,
		});
		result.success = false;
		result.error = 'Implementation completed but no PR was created';
	}

	// Zero out cost for subscription-backed Claude Code sessions
	if (
		backend.name === 'claude-code' &&
		input.project.agentBackend?.subscriptionCostZero === true &&
		result.cost !== undefined &&
		result.cost > 0
	) {
		logger.info('Zeroing Claude Code cost (subscription mode)', {
			originalCost: result.cost,
			project: input.project.id,
		});
		result.cost = 0;
	}
}

/**
 * Execute an agent using the given backend with full lifecycle management.
 * This handles repository setup, context fetching, logging, and cleanup.
 *
 * Used by non-llmist backends. The llmist backend wraps existing code directly.
 */
async function tryCreateBackendRun(
	agentType: string,
	backendName: string,
	input: AgentInput & { project: ProjectConfig },
	model?: string,
	maxIterations?: number,
): Promise<string | undefined> {
	try {
		return await createRun({
			projectId: input.project.id,
			cardId: input.cardId,
			prNumber: input.prNumber,
			agentType,
			backend: backendName,
			triggerType: input.triggerType,
			model,
			maxIterations,
		});
	} catch (err) {
		logger.warn('Failed to create run record', { error: String(err) });
		return undefined;
	}
}

async function tryStoreBackendLogs(
	runId: string,
	fileLogger: ReturnType<typeof createFileLogger>,
): Promise<void> {
	try {
		const cascadeLog = fs.existsSync(fileLogger.logPath)
			? fs.readFileSync(fileLogger.logPath, 'utf-8')
			: undefined;
		const llmistLog = fs.existsSync(fileLogger.llmistLogPath)
			? fs.readFileSync(fileLogger.llmistLogPath, 'utf-8')
			: undefined;
		await storeRunLogs(runId, cascadeLog, llmistLog);
	} catch (err) {
		logger.warn('Failed to store backend run logs', { runId, error: String(err) });
	}
}

async function tryCompleteBackendRun(runId: string, input: CompleteRunInput): Promise<void> {
	try {
		await completeRun(runId, input);
	} catch (err) {
		logger.warn('Failed to complete backend run record', { runId, error: String(err) });
	}
}

function warnIfSubscriptionCostMismatch(_backend: AgentBackend, _project: ProjectConfig): void {
	// No-op: ANTHROPIC_API_KEY is no longer used. Claude Code uses OAuth only.
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

async function finalizeBackendRun(
	runId: string | undefined,
	fileLogger: ReturnType<typeof createFileLogger>,
	input: CompleteRunInput,
): Promise<void> {
	if (!runId) return;
	await tryStoreBackendLogs(runId, fileLogger);
	await tryCompleteBackendRun(runId, input);
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
		const logWriter = createLogWriter(fileLogger);

		const profile = getAgentProfile(agentType);
		const gitHubToken = await resolveGitHubToken(profile, input.project.id, agentType);

		// Build backend input and run pre-execute, wrapped in GitHub token scope if needed
		const resolvedRepoDir = repoDir;
		const buildAndPrepare = async () => {
			const partial = await buildBackendInput(
				agentType,
				input,
				resolvedRepoDir,
				logWriter,
				log,
				backend.name,
			);

			// Override GITHUB_TOKEN in subprocess secrets with agent-scoped token
			if (gitHubToken && profile.needsGitHubToken) {
				partial.projectSecrets = {
					...partial.projectSecrets,
					GITHUB_TOKEN: gitHubToken,
				};
			}

			// Pre-execute hook (e.g., post initial PR comment for review)
			if (profile.preExecute) {
				await profile.preExecute({ input, logWriter });
			}

			return partial;
		};

		const partialInput = gitHubToken
			? await withGitHubToken(gitHubToken, buildAndPrepare)
			: await buildAndPrepare();

		runId = await tryCreateBackendRun(
			agentType,
			backend.name,
			input,
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
		warnIfSubscriptionCostMismatch(backend, input.project);

		try {
			const result = await backend.execute(backendInput);
			postProcessResult(result, agentType, backend, input, identifier);

			fileLogger.close();
			const logBuffer = await fileLogger.getZippedBuffer();

			await finalizeBackendRun(runId, fileLogger, {
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

		await finalizeBackendRun(runId, fileLogger, {
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
