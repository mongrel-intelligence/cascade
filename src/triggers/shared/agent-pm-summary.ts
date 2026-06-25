import { isPmPostingEnabled, resolveUpdateChannel } from '../../config/updateChannel.js';
import { getSessionState } from '../../gadgets/sessionState.js';
import type { AgentResult, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import {
	isOutputBasedAgent,
	PM_SUMMARY_AGENT_TYPES,
	postAgentOutputToPM,
	postReviewToPM,
} from './agent-pm-poster.js';
import { resolveWorkItemId } from './agent-work-items.js';

/**
 * Post an agent summary to the PM work item after a successful agent run.
 * Cross-source concern: fires for all trigger types (GitHub, Trello, JIRA).
 *
 * Handles two cases:
 * - review agent: structured session state (reviewBody/reviewEvent/reviewUrl)
 * - output-based agents: AgentResult.output with per-agent-type formatting
 *
 * The summary/review comment is communication-only, so it is gated on the
 * agent's resolved update channel: when PM posting is disabled the function
 * early-returns without posting (workflow actions are gated elsewhere).
 */
export async function postAgentSummaryToPM(
	agentType: string,
	agentResult: AgentResult,
	workItemId: string | undefined,
	project: ProjectConfig,
	prNumber: number | undefined,
): Promise<void> {
	if (!agentResult.success || !PM_SUMMARY_AGENT_TYPES.has(agentType)) return;

	if (!isPmPostingEnabled(resolveUpdateChannel(project, agentType))) {
		logger.info('Agent PM summary skipped: PM posting disabled for update channel', {
			agentType,
			projectId: project.id,
		});
		return;
	}

	const projectId = project.id;

	if (isOutputBasedAgent(agentType)) {
		const resolvedWorkItemId = await resolveWorkItemId(workItemId, projectId, prNumber);
		if (!resolvedWorkItemId) {
			logger.warn('Agent PM posting skipped: no workItemId found', {
				agentType,
				projectId,
				prNumber,
			});
			return;
		}

		logger.info('Posting agent output summary to PM work item', {
			agentType,
			workItemId: resolvedWorkItemId,
			hasProgressCommentId: !!agentResult.progressCommentId,
		});

		await postAgentOutputToPM(
			resolvedWorkItemId,
			agentType,
			agentResult.output,
			agentResult.progressCommentId,
		);
		return;
	}

	const sessionState = getSessionState();
	if (!sessionState.reviewBody) {
		logger.warn('Review PM posting skipped: no reviewBody in session state');
		return;
	}

	const resolvedWorkItemId = await resolveWorkItemId(workItemId, projectId, prNumber);
	if (!resolvedWorkItemId) {
		logger.warn('Agent PM posting skipped: no workItemId found', {
			agentType,
			projectId,
			prNumber,
		});
		return;
	}

	logger.info('Posting review summary to PM work item', {
		workItemId: resolvedWorkItemId,
		hasProgressCommentId: !!agentResult.progressCommentId,
		event: sessionState.reviewEvent,
	});

	await postReviewToPM(
		resolvedWorkItemId,
		{
			reviewBody: sessionState.reviewBody,
			reviewEvent: sessionState.reviewEvent,
			reviewUrl: sessionState.reviewUrl,
		},
		agentResult.progressCommentId,
	);
}
