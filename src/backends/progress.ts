import type { ModelSpec } from 'llmist';

import { getStatusUpdateConfig } from '../config/statusUpdateConfig.js';
import { ProgressMonitor, type ProgressMonitorConfig } from './progressMonitor.js';
import type { LogWriter } from './types.js';

export interface ProgressMonitorOptions {
	logWriter: LogWriter;
	agentType: string;
	taskDescription: string;
	progressModel: string;
	intervalMinutes: number;
	customModels: ModelSpec[];
	repoDir?: string;
	trello?: { cardId: string };
	github?: { owner: string; repo: string; headerMessage: string };
	/** Pre-seeded comment ID from router ack — skip initial comment posting */
	preSeededCommentId?: string;
}

/**
 * Creates a ProgressMonitor that posts time-based progress updates
 * using a lightweight LLM for natural-language summaries.
 *
 * Returns null if status updates are disabled for this agent type.
 */
export function createProgressMonitor(options: ProgressMonitorOptions): ProgressMonitor | null {
	const statusConfig = getStatusUpdateConfig(options.agentType);
	if (!statusConfig.enabled) {
		return null;
	}

	const config: ProgressMonitorConfig = {
		agentType: options.agentType,
		taskDescription: options.taskDescription,
		intervalMinutes: options.intervalMinutes,
		progressModel: options.progressModel,
		customModels: options.customModels,
		logWriter: options.logWriter,
		repoDir: options.repoDir,
		trello: options.trello,
		github: options.github,
		preSeededCommentId: options.preSeededCommentId,
	};

	return new ProgressMonitor(config);
}

export { ProgressMonitor } from './progressMonitor.js';
