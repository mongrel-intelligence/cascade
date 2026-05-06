import fs from 'node:fs';

import {
	type CompleteRunInput,
	completeRun,
	createRun,
	storeRunLogs,
	updateRunJobId,
	updateRunPlanResolution,
} from '../../db/repositories/runsRepository.js';
import { logger } from '../../utils/logging.js';
import { BootFailureError } from './bootFailureError.js';
import type { FileLogger } from './executionPipeline.js';

// ============================================================================
// Run Tracking Configuration
// ============================================================================

export interface RunTrackingInput {
	projectId: string;
	workItemId?: string;
	prNumber?: number;
	agentType: string;
	engineName: string;
	triggerType?: string;
}

// ============================================================================
// Shared Run Tracking Helpers
// ============================================================================

/**
 * Create a DB run record. Spec 018 intentionally treats creation failure as a
 * boot failure instead of a silent warn-and-continue: without this row, the
 * dashboard cannot show the job at all.
 *
 * If JOB_ID env var is set (Docker mode), store it immediately after run creation.
 */
export async function tryCreateRun(
	input: RunTrackingInput,
	model?: string,
	maxIterations?: number,
): Promise<string | undefined> {
	try {
		const runId = await createRun({
			projectId: input.projectId,
			workItemId: input.workItemId,
			prNumber: input.prNumber,
			agentType: input.agentType,
			engine: input.engineName,
			triggerType: input.triggerType,
			model,
			maxIterations,
		});

		// Store BullMQ jobId if running in Docker (JOB_ID env var is set)
		const jobId = process.env.JOB_ID;
		if (jobId) {
			try {
				await updateRunJobId(runId, jobId);
			} catch (err) {
				logger.warn('Failed to store job ID for run', { runId, jobId, error: String(err) });
				// Continue - failure to store jobId should not block agent execution
			}
		}

		return runId;
	} catch (err) {
		throw new BootFailureError('failed to create run record', {
			phase: 'run-record',
			cause: err,
		});
	}
}

/**
 * Store cascade and engine log files for a run, suppressing errors.
 */
export async function tryStoreRunLogs(runId: string, fileLogger: FileLogger): Promise<void> {
	try {
		const cascadeLog = fs.existsSync(fileLogger.logPath)
			? fs.readFileSync(fileLogger.logPath, 'utf-8')
			: undefined;
		const engineLog = fs.existsSync(fileLogger.engineLogPath)
			? fs.readFileSync(fileLogger.engineLogPath, 'utf-8')
			: undefined;
		await storeRunLogs(runId, cascadeLog, engineLog);
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
 * Finalize an engine run: store logs and mark complete.
 */
export async function finalizeEngineRun(
	runId: string | undefined,
	fileLogger: FileLogger,
	input: CompleteRunInput,
): Promise<void> {
	if (!runId) return;
	await tryStoreRunLogs(runId, fileLogger);
	await tryCompleteRun(runId, input);
}

/**
 * Spec 018: deferred-fill for plan-resolution fields. The run row is created
 * upfront so boot-time failures are visible; this helper fills in `model` and
 * `maxIterations` after `resolvePartialExecutionPlan` succeeds. Errors are
 * suppressed (the run can proceed without these fields populated; observability
 * shouldn't block agent execution).
 */
export async function tryUpdateRunPlanResolution(
	runId: string | undefined,
	model: string | undefined,
	maxIterations: number | undefined,
): Promise<void> {
	if (!runId) return;
	try {
		await updateRunPlanResolution(runId, model, maxIterations);
	} catch (err) {
		logger.warn('Failed to update run plan resolution', { runId, error: String(err) });
	}
}
