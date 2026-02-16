import fs from 'node:fs';

import {
	type CompleteRunInput,
	completeRun,
	createRun,
	storeRunLogs,
} from '../../db/repositories/runsRepository.js';
import { logger } from '../../utils/logging.js';
import type { AgentBackend } from '../types.js';

/**
 * Create a backend run record in the database.
 * Returns runId if successful, undefined if failed.
 */
export async function tryCreateBackendRun(
	agentType: string,
	backendName: string,
	projectId: string,
	cardId?: string,
	prNumber?: number,
	triggerType?: string,
	model?: string,
	maxIterations?: number,
): Promise<string | undefined> {
	try {
		return await createRun({
			projectId,
			cardId,
			prNumber,
			agentType,
			backend: backendName,
			triggerType,
			model,
			maxIterations,
		});
	} catch (err) {
		logger.warn('Failed to create run record', { error: String(err) });
		return undefined;
	}
}

/**
 * Store backend run logs in the database.
 */
export async function tryStoreBackendLogs(
	runId: string,
	logPath: string,
	llmistLogPath: string,
): Promise<void> {
	try {
		const cascadeLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : undefined;
		const llmistLog = fs.existsSync(llmistLogPath)
			? fs.readFileSync(llmistLogPath, 'utf-8')
			: undefined;
		await storeRunLogs(runId, cascadeLog, llmistLog);
	} catch (err) {
		logger.warn('Failed to store backend run logs', { runId, error: String(err) });
	}
}

/**
 * Complete a backend run record in the database.
 */
export async function tryCompleteBackendRun(runId: string, input: CompleteRunInput): Promise<void> {
	try {
		await completeRun(runId, input);
	} catch (err) {
		logger.warn('Failed to complete backend run record', { runId, error: String(err) });
	}
}

/**
 * Finalize a backend run: store logs and mark as complete.
 */
export async function finalizeBackendRun(
	runId: string | undefined,
	logPath: string,
	llmistLogPath: string,
	input: CompleteRunInput,
): Promise<void> {
	if (!runId) return;
	await tryStoreBackendLogs(runId, logPath, llmistLogPath);
	await tryCompleteBackendRun(runId, input);
}

/**
 * Post-process a backend result: validate PR creation for implementation agents
 * and zero out cost for subscription-backed Claude Code sessions.
 */
export function postProcessResult(
	result: Awaited<ReturnType<AgentBackend['execute']>>,
	agentType: string,
	backend: AgentBackend,
	projectId: string,
	subscriptionCostZero: boolean,
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
		subscriptionCostZero === true &&
		result.cost !== undefined &&
		result.cost > 0
	) {
		logger.info('Zeroing Claude Code cost (subscription mode)', {
			originalCost: result.cost,
			project: projectId,
		});
		result.cost = 0;
	}
}
