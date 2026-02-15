import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../../agents/registry.js';
import {
	getLlmCallsByRunId,
	getRunById,
	getRunLogs,
	storeDebugAnalysis,
} from '../../db/repositories/runsRepository.js';
import { trelloClient } from '../../trello/client.js';
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
	if (logs?.llmistLog) {
		fs.writeFileSync(join(logDir, 'llmist.log'), logs.llmistLog, 'utf-8');
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
export async function triggerDebugAnalysis(
	analyzedRunId: string,
	project: ProjectConfig,
	config: CascadeConfig,
	cardId?: string,
): Promise<void> {
	const run = await getRunById(analyzedRunId);
	if (!run) {
		logger.warn('Run not found for debug analysis', { analyzedRunId });
		return;
	}

	logger.info('Starting debug analysis', {
		analyzedRunId,
		agentType: run.agentType,
		cardId,
	});

	let logDir: string | undefined;
	try {
		logDir = await extractLogsToTempDir(analyzedRunId);

		const originalCardName = cardId ? `Card ${cardId}` : 'Unknown card';
		const originalCardUrl = cardId ? `https://trello.com/c/${cardId}` : '';

		const agentResult: AgentResult = await runAgent('debug', {
			logDir,
			originalCardId: cardId,
			originalCardName,
			originalCardUrl,
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
			severity: run.status === 'timed_out' ? 'timeout' : 'failure',
		});

		// Post summary comment on original Trello card
		if (cardId && parsed.summary) {
			try {
				const rootCauseText = parsed.rootCause
					? `**Root Cause:** ${parsed.rootCause.slice(0, 200)}\n\n`
					: '';
				const comment = `🔍 **Debug Analysis** (run: ${analyzedRunId.slice(0, 8)})\n\n${parsed.summary}\n\n${rootCauseText}_Full analysis stored in database._`;
				await trelloClient.addComment(cardId, comment);
			} catch (err) {
				logger.warn('Failed to post debug summary comment', {
					cardId,
					error: String(err),
				});
			}
		}

		logger.info('Debug analysis completed', {
			analyzedRunId,
			debugRunId: agentResult.runId,
			success: agentResult.success,
		});
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
