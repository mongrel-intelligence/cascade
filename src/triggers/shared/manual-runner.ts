import { runAgent } from '../../agents/registry.js';
import { getRunById } from '../../db/repositories/runsRepository.js';
import { withPMCredentials } from '../../pm/context.js';
import { createPMProvider, pmRegistry, withPMProvider } from '../../pm/index.js';
import type { AgentInput, CascadeConfig, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
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

/**
 * Input for manual agent triggers.
 */
export interface ManualTriggerInput {
	projectId: string;
	agentType: string;
	workItemId?: string;
	prNumber?: number;
	prBranch?: string;
	repoFullName?: string;
	headSha?: string;
	modelOverride?: string;
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

	// Pre-flight integration validation
	const validation = await validateIntegrations(input.projectId, input.agentType);
	if (!validation.valid) {
		throw new Error(formatValidationErrors(validation));
	}

	logger.info('Triggering manual agent run', {
		projectId: input.projectId,
		agentType: input.agentType,
		workItemId: input.workItemId,
		prNumber: input.prNumber,
		modelOverride: input.modelOverride,
	});

	markTriggerRunning(triggerKey);

	const agentInput: AgentInput & { project: ProjectConfig; config: CascadeConfig } = {
		workItemId: input.workItemId,
		prNumber: input.prNumber,
		prBranch: input.prBranch,
		repoFullName: input.repoFullName,
		headSha: input.headSha,
		modelOverride: input.modelOverride,
		triggerType: 'manual',
		project,
		config,
	};

	try {
		const pmProvider = createPMProvider(project);
		const result = await withPMCredentials(
			project.id,
			project.pm?.type,
			(t) => pmRegistry.getOrNull(t),
			() => withPMProvider(pmProvider, () => runAgent(input.agentType, agentInput)),
		);
		if (result !== undefined) {
			logger.info('Manual agent run completed', {
				projectId: input.projectId,
				agentType: input.agentType,
				success: result.success,
				runId: result.runId,
			});
		}
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
