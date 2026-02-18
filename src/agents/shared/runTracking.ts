import fs from 'node:fs';

import {
	type CompleteRunInput,
	completeRun,
	createRun,
	storeRunLogs,
} from '../../db/repositories/runsRepository.js';
import { logger } from '../../utils/logging.js';
import type { FileLogger } from './lifecycle.js';

// ============================================================================
// Run Tracking Configuration
// ============================================================================

export interface RunTrackingInput {
	projectId: string;
	cardId?: string;
	prNumber?: number;
	agentType: string;
	backendName: string;
	triggerType?: string;
}

// ============================================================================
// Shared Run Tracking Helpers
// ============================================================================

/**
 * Create a DB run record, suppressing errors so agent execution is unaffected.
 */
export async function tryCreateRun(
	input: RunTrackingInput,
	model?: string,
	maxIterations?: number,
): Promise<string | undefined> {
	try {
		return await createRun({
			projectId: input.projectId,
			cardId: input.cardId,
			prNumber: input.prNumber,
			agentType: input.agentType,
			backend: input.backendName,
			triggerType: input.triggerType,
			model,
			maxIterations,
		});
	} catch (err) {
		logger.warn('Failed to create run record', { error: String(err) });
		return undefined;
	}
}

/**
 * Store cascade and llmist log files for a run, suppressing errors.
 */
export async function tryStoreRunLogs(runId: string, fileLogger: FileLogger): Promise<void> {
	try {
		const cascadeLog = fs.existsSync(fileLogger.logPath)
			? fs.readFileSync(fileLogger.logPath, 'utf-8')
			: undefined;
		const llmistLog = fs.existsSync(fileLogger.llmistLogPath)
			? fs.readFileSync(fileLogger.llmistLogPath, 'utf-8')
			: undefined;
		await storeRunLogs(runId, cascadeLog, llmistLog);
	} catch (err) {
		logger.warn('Failed to store run logs', { runId, error: String(err) });
	}
}

/**
 * Mark a run as complete in the DB, suppressing errors.
 */
export async function tryCompleteRun(runId: string, input: CompleteRunInput): Promise<void> {
	try {
		await completeRun(runId, input);
	} catch (err) {
		logger.warn('Failed to complete run record', { runId, error: String(err) });
	}
}

/**
 * Finalize a backend run: store logs and mark complete.
 * Used by non-llmist backends (claude-code adapter) that don't accumulate LLM calls.
 */
export async function finalizeBackendRun(
	runId: string | undefined,
	fileLogger: FileLogger,
	input: CompleteRunInput,
): Promise<void> {
	if (!runId) return;
	await tryStoreRunLogs(runId, fileLogger);
	await tryCompleteRun(runId, input);
}
