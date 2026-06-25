import type { ModelSpec } from 'llmist';

import type { LogWriter } from '../agents/shared/executionPipeline.js';
import { CUSTOM_MODELS } from '../config/customModels.js';
import {
	isPmPostingEnabled,
	isScmPostingEnabled,
	resolveUpdateChannel,
} from '../config/updateChannel.js';
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
	syncChecklist = false,
) {
	const { workItemId } = input;

	// Gate system-driven progress posting on the agent's resolved update channel.
	// ProgressMonitor already no-ops each poster when its config block is absent,
	// so gating = omitting `trello` (PM) / `github` (SCM) when the channel
	// disables that surface. Communication only — status moves, labels, linkPR,
	// and PR creation are gated elsewhere (or not at all).
	const updateChannel = resolveUpdateChannel(input.project, agentType);
	const pmPostingEnabled = isPmPostingEnabled(updateChannel);
	const scmPostingEnabled = isScmPostingEnabled(updateChannel);

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
		trello: pmPostingEnabled && workItemId ? { workItemId } : undefined,
		preSeededCommentId: isGitHubAck ? undefined : (input.ackCommentId as string | undefined),
		runLink,
		syncChecklist,
		...(scmPostingEnabled && input.prNumber && input.repoFullName
			? {
					github: {
						owner: input.repoFullName.split('/')[0],
						repo: input.repoFullName.split('/')[1],
					},
				}
			: {}),
	};
}
