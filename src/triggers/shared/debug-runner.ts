import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../../agents/registry.js';
import {
	clearDebugAnalysisStatus,
	getLlmCallsByRunId,
	getRunById,
	getRunLogs,
	markDebugAnalysisFailed,
	markDebugAnalysisRunning,
	storeDebugAnalysis,
} from '../../db/repositories/runsRepository.js';
import { getPMProvider } from '../../pm/index.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { cleanupTempDir } from '../../utils/repo.js';

/**
 * Extract logs from the database and write them to a temp directory
 * in the same structure the debug agent expects.
 */
async function extractLogsToTempDir(runId: string): Promise<string> {
	const logDir = join(tmpdir(), `debug-${runId}-${Date.now()}`);
	fs.mkdirSync(logDir, { recursive: true });

	const logs = await getRunLogs(runId);
	if (logs?.cascadeLog) {
		fs.writeFileSync(join(logDir, 'cascade.log'), logs.cascadeLog, 'utf-8');
	}
	if (logs?.engineLog) {
		fs.writeFileSync(join(logDir, 'engine.log'), logs.engineLog, 'utf-8');
	}

	// Write LLM call request/response files
	const llmCalls = await getLlmCallsByRunId(runId);
	if (llmCalls.length > 0) {
		const llmCallsDir = join(logDir, 'llm-calls');
		fs.mkdirSync(llmCallsDir, { recursive: true });
		for (const call of llmCalls) {
			const num = call.callNumber.toString().padStart(4, '0');
			if (call.request) {
				fs.writeFileSync(join(llmCallsDir, `${num}.request`), call.request, 'utf-8');
			}
			if (call.response) {
				fs.writeFileSync(join(llmCallsDir, `${num}.response`), call.response, 'utf-8');
			}
		}
	}

	return logDir;
}

/**
 * Parse structured sections from the debug agent's markdown output.
 */
function parseDebugOutput(output: string): {
	summary: string;
	issues: string;
	timeline?: string;
	rootCause?: string;
	recommendations?: string;
} {
	const sections: Record<string, string> = {};
	let currentSection = '';
	const lines = output.split('\n');

	for (const line of lines) {
		const headerMatch = line.match(/^##\s+(.+)/);
		if (headerMatch) {
			currentSection = headerMatch[1].trim().toLowerCase();
		} else if (currentSection) {
			const key = currentSection;
			sections[key] = `${sections[key] ?? ''}${line}\n`;
		}
	}

	// Map various header names to our fields
	const findSection = (...keys: string[]): string | undefined => {
		for (const key of keys) {
			for (const [sectionKey, value] of Object.entries(sections)) {
				if (sectionKey.includes(key)) {
					return value.trim();
				}
			}
		}
		return undefined;
	};

	return {
		summary: findSection('summary', 'executive') ?? output.slice(0, 500),
		issues: findSection('issues', 'key issues', 'problems') ?? '',
		timeline: findSection('timeline', 'events'),
		rootCause: findSection('root cause', 'cause'),
		recommendations: findSection('recommendations', 'actions'),
	};
}

/**
 * Trigger debug analysis for a failed/timed_out run.
 *
 * Flow:
 * 1. Extract logs from DB to temp directory
 * 2. Run the debug agent
 * 3. Parse structured sections from output
 * 4. Store debug analysis in DB
 * 5. Post summary comment on original Trello card
 * 6. Cleanup temp directory
 */
function resolveWorkItemUrl(workItemId: string): string {
	try {
		const provider = getPMProvider();
		return provider.getWorkItemUrl(workItemId);
	} catch {
		return `https://trello.com/c/${workItemId}`;
	}
}

async function postDebugComment(
	workItemId: string,
	analyzedRunId: string,
	parsed: ReturnType<typeof parseDebugOutput>,
): Promise<void> {
	try {
		const provider = getPMProvider();
		const rootCauseText = parsed.rootCause
			? `**Root Cause:** ${parsed.rootCause.slice(0, 200)}\n\n`
			: '';
		const comment = `🔍 **Debug Analysis** (run: ${analyzedRunId.slice(0, 8)})\n\n${parsed.summary}\n\n${rootCauseText}_Full analysis stored in database._`;
		await provider.addComment(workItemId, comment);
	} catch (err) {
		logger.warn('Failed to post debug summary comment', {
			workItemId,
			error: String(err),
		});
	}
}

export async function triggerDebugAnalysis(
	analyzedRunId: string,
	project: ProjectConfig,
	config: CascadeConfig,
	workItemId?: string,
): Promise<void> {
	const run = await getRunById(analyzedRunId);
	if (!run) {
		logger.warn('Run not found for debug analysis', { analyzedRunId });
		return;
	}

	logger.info('Starting debug analysis', {
		analyzedRunId,
		agentType: run.agentType,
		workItemId,
	});

	// Durable, cross-process `running` marker. The analysis runs in this worker
	// container while the dashboard API (a separate process) polls status, so an
	// in-memory flag is never visible to it. Idempotent: the dashboard may have
	// already marked running at trigger time.
	await markDebugAnalysisRunning(analyzedRunId);
	let logDir: string | undefined;
	try {
		logDir = await extractLogsToTempDir(analyzedRunId);

		const agentResult: AgentResult = await runAgent('debug', {
			logDir,
			originalWorkItemId: workItemId,
			originalWorkItemName: workItemId ? `Card ${workItemId}` : 'Unknown card',
			originalWorkItemUrl: workItemId ? resolveWorkItemUrl(workItemId) : '',
			detectedAgentType: run.agentType,
			project,
			config,
		});

		const parsed = parseDebugOutput(agentResult.output);

		await storeDebugAnalysis({
			analyzedRunId,
			debugRunId: agentResult.runId,
			summary: parsed.summary,
			issues: parsed.issues,
			timeline: parsed.timeline,
			recommendations: parsed.recommendations,
			rootCause: parsed.rootCause,
			severity:
				run.status === 'timed_out' ? 'timeout' : run.status === 'failed' ? 'failure' : 'manual',
		});

		if (workItemId && parsed.summary) {
			await postDebugComment(workItemId, analyzedRunId, parsed);
		}

		// Success: clear the lifecycle marker. The persisted debug_analyses row is
		// now the `completed` signal.
		await clearDebugAnalysisStatus(analyzedRunId);

		logger.info('Debug analysis completed', {
			analyzedRunId,
			debugRunId: agentResult.runId,
			success: agentResult.success,
		});
	} catch (err) {
		// Failure: persist `failed` so status reflects the failed analysis (not
		// `idle`) and surfaces the re-run affordance. Don't let a status-write
		// error mask the original failure.
		await markDebugAnalysisFailed(analyzedRunId).catch((statusErr) => {
			logger.warn('Failed to mark debug analysis failed', {
				analyzedRunId,
				error: String(statusErr),
			});
		});
		throw err;
	} finally {
		if (logDir) {
			try {
				cleanupTempDir(logDir);
			} catch {
				// Ignore cleanup errors
			}
		}
	}
}
