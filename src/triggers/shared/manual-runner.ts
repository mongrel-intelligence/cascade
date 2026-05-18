import { isPMFocusedAgent } from '../../agents/definitions/loader.js';
import { isAgentEnabledForProject } from '../../db/repositories/agentConfigsRepository.js';
import { getRunById } from '../../db/repositories/runsRepository.js';
import { withPMCredentials } from '../../pm/context.js';
import { createPMProvider, pmRegistry, withPMProvider } from '../../pm/index.js';
import type { AgentInput, CascadeConfig, ProjectConfig, TriggerResult } from '../../types/index.js';
import { startWatchdog } from '../../utils/lifecycle.js';
import { logger } from '../../utils/logging.js';
import { runAgentExecutionPipeline } from './agent-execution.js';
import type { AgentExecutionConfig } from './agent-execution-types.js';
import { formatValidationErrors, validateIntegrations } from './integration-validation.js';

/**
 * In-memory tracking to prevent duplicate concurrent manual triggers.
 */
const runningTriggers = new Map<string, boolean>();

function generateTriggerKey(
	projectId: string,
	agentType: string,
	workItemId?: string,
	prNumber?: number,
): string {
	return `${projectId}:${agentType}:${workItemId ?? 'no-card'}:${prNumber ?? 'no-pr'}`;
}

function markTriggerRunning(key: string): void {
	runningTriggers.set(key, true);
}

function markTriggerComplete(key: string): void {
	runningTriggers.delete(key);
}

export function isTriggerRunning(key: string): boolean {
	return runningTriggers.has(key);
}

/**
 * Clear all trigger tracking (test utility).
 */
export function clearTriggerTracking(): void {
	runningTriggers.clear();
}

async function resolveManualExecutionConfig(
	input: ManualTriggerInput,
): Promise<AgentExecutionConfig | undefined> {
	if (!input.prNumber) return undefined;
	if (await isPMFocusedAgent(input.agentType)) return undefined;

	return {
		skipPrepareForAgent: true,
		skipHandleFailure: true,
		handleSuccessOnlyForAgentType: 'implementation',
		logLabel: 'GitHub manual agent',
	};
}

/**
 * Input for manual agent triggers.
 */
export interface ManualTriggerInput {
	projectId: string;
	agentType: string;
	workItemId?: string;
	workItemUrl?: string;
	workItemTitle?: string;
	prNumber?: number;
	prBranch?: string;
	repoFullName?: string;
	headSha?: string;
	modelOverride?: string;
	// Comment-trigger fields — required for respond-to-pr-comment to know what was asked
	triggerCommentBody?: string;
	triggerCommentId?: number;
	triggerCommentUrl?: string;
	triggerCommentPath?: string;
	triggerCommentAuthor?: string;
}

/**
 * Trigger a manual agent run.
 *
 * Awaits runAgent completion so callers (e.g. worker containers) can
 * block until the agent finishes. The API router caller already does not
 * await the outer promise, so API response behavior is unchanged.
 * Status tracking is handled via in-memory map to prevent duplicates.
 */
export async function triggerManualRun(
	input: ManualTriggerInput,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	const triggerKey = generateTriggerKey(
		input.projectId,
		input.agentType,
		input.workItemId,
		input.prNumber,
	);

	if (isTriggerRunning(triggerKey)) {
		throw new Error(
			`Manual trigger already running for project=${input.projectId}, agent=${input.agentType}, card=${input.workItemId ?? 'N/A'}, pr=${input.prNumber ?? 'N/A'}`,
		);
	}

	// Check agent is explicitly enabled for this project
	const agentEnabled = await isAgentEnabledForProject(input.projectId, input.agentType);
	if (!agentEnabled) {
		throw new Error(
			`Agent '${input.agentType}' is not enabled for project '${input.projectId}'. Add an agent config in Project Settings > Agent Configs to enable it.`,
		);
	}

	// Pre-flight integration validation
	const validation = await validateIntegrations(input.projectId, input.agentType, project);
	if (!validation.valid) {
		throw new Error(formatValidationErrors(validation));
	}

	logger.info('Triggering manual agent run', {
		projectId: input.projectId,
		agentType: input.agentType,
		workItemId: input.workItemId,
		workItemUrl: input.workItemUrl,
		workItemTitle: input.workItemTitle,
		prNumber: input.prNumber,
		modelOverride: input.modelOverride,
	});

	markTriggerRunning(triggerKey);

	const agentInput: AgentInput = {
		workItemId: input.workItemId,
		workItemUrl: input.workItemUrl,
		workItemTitle: input.workItemTitle,
		prNumber: input.prNumber,
		prBranch: input.prBranch,
		repoFullName: input.repoFullName,
		headSha: input.headSha,
		modelOverride: input.modelOverride,
		triggerType: 'manual',
		triggerCommentBody: input.triggerCommentBody,
		triggerCommentId: input.triggerCommentId,
		triggerCommentUrl: input.triggerCommentUrl,
		triggerCommentPath: input.triggerCommentPath,
		triggerCommentAuthor: input.triggerCommentAuthor,
	};
	const triggerResult: TriggerResult = {
		agentType: input.agentType,
		agentInput,
		workItemId: input.workItemId,
		workItemUrl: input.workItemUrl,
		workItemTitle: input.workItemTitle,
		prNumber: input.prNumber,
	};

	try {
		startWatchdog(project.watchdogTimeoutMs);

		const pmProvider = createPMProvider(project);
		const executionConfig = await resolveManualExecutionConfig(input);
		await withPMCredentials(
			project.id,
			project.pm?.type,
			(t) => pmRegistry.getOrNull(t),
			() =>
				withPMProvider(pmProvider, () =>
					executionConfig
						? runAgentExecutionPipeline(triggerResult, project, config, executionConfig)
						: runAgentExecutionPipeline(triggerResult, project, config),
				),
		);
		logger.info('Manual agent run completed', {
			projectId: input.projectId,
			agentType: input.agentType,
		});
	} catch (err) {
		logger.error('Manual agent run failed', {
			projectId: input.projectId,
			agentType: input.agentType,
			error: String(err),
		});
	} finally {
		markTriggerComplete(triggerKey);
	}
}

/**
 * Retry a previous agent run.
 *
 * Reads the original run from DB, extracts parameters, and triggers a new manual run.
 */
export async function triggerRetryRun(
	runId: string,
	project: ProjectConfig,
	config: CascadeConfig,
	modelOverride?: string,
): Promise<void> {
	const run = await getRunById(runId);
	if (!run) {
		throw new Error(`Run not found: ${runId}`);
	}

	if (!run.projectId) {
		throw new Error(`Run ${runId} has no associated project`);
	}

	logger.info('Retrying agent run', {
		originalRunId: runId,
		agentType: run.agentType,
		projectId: run.projectId,
		modelOverride,
	});

	// Extract params from original run
	const triggerInput: ManualTriggerInput = {
		projectId: run.projectId,
		agentType: run.agentType,
		workItemId: run.workItemId ?? undefined,
		prNumber: run.prNumber ?? undefined,
		modelOverride: modelOverride ?? run.model ?? undefined,
	};

	// For PR-based agents, we don't store branch/SHA in DB, so we can't restore them.
	// The retry will fetch fresh data from GitHub if needed.

	await triggerManualRun(triggerInput, project, config);
}
