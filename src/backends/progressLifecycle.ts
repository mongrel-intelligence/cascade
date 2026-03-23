import type { ModelSpec } from 'llmist';

import type { LogWriter } from '../agents/shared/executionPipeline.js';
import { CUSTOM_MODELS } from '../config/customModels.js';
import type { AgentInput, CascadeConfig, ProjectConfig } from '../types/index.js';
import { getDashboardUrl } from '../utils/runLink.js';

/**
 * Determine whether the incoming ack comment is a GitHub PR comment (numeric ID).
 * Used to route between GitHub progress posting and PM progress posting.
 */
export function isGitHubAckComment(input: AgentInput): boolean {
	return Boolean(input.prNumber && input.repoFullName && typeof input.ackCommentId === 'number');
}

/**
 * Build progress-monitor config from pipeline inputs.
 */
export function buildProgressMonitorConfig(
	input: AgentInput & { config: CascadeConfig; project: ProjectConfig },
	agentType: string,
	logWriter: LogWriter,
	repoDir: string | null,
	isGitHubAck: boolean,
	engineId: string,
	model: string,
) {
	const { workItemId } = input;

	// Build run link config when the project has run links enabled and dashboard URL is set
	const runLink =
		input.project.runLinksEnabled && getDashboardUrl()
			? {
					engineLabel: engineId,
					model,
					projectId: input.project.id,
					workItemId: workItemId ?? undefined,
				}
			: undefined;

	return {
		logWriter,
		agentType,
		taskDescription: workItemId ? `Work item ${workItemId}` : 'Unknown task',
		progressModel: input.project.progressModel,
		intervalMinutes: input.project.progressIntervalMinutes,
		customModels: CUSTOM_MODELS as ModelSpec[],
		repoDir: repoDir ?? undefined,
		trello: workItemId ? { workItemId } : undefined,
		preSeededCommentId: isGitHubAck ? undefined : (input.ackCommentId as string | undefined),
		runLink,
		...(input.prNumber && input.repoFullName
			? {
					github: {
						owner: input.repoFullName.split('/')[0],
						repo: input.repoFullName.split('/')[1],
					},
				}
			: {}),
	};
}
