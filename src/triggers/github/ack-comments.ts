/**
 * GitHub acknowledgment comment helpers.
 *
 * Handles posting, deleting, and updating PR comments that acknowledge
 * incoming webhook events and report agent status.
 */

import { INITIAL_MESSAGES } from '../../config/agentMessages.js';
import { githubClient } from '../../github/client.js';
import { extractGitHubContext, generateAckMessage } from '../../router/ackMessageGenerator.js';
import type { AgentResult, ProjectConfig } from '../../types/index.js';
import { parseRepoFullName } from '../../utils/repo.js';
import { safeOperation } from '../../utils/safeOperation.js';
import type { TriggerResult } from '../types.js';

/**
 * Delete the progress comment after a successful non-implementation agent run.
 *
 * The implementation agent's success is handled via lifecycle (handleSuccess),
 * which manages the PR comment separately.
 */
export async function deleteProgressCommentOnSuccess(
	result: TriggerResult,
	_agentResult: AgentResult,
): Promise<void> {
	if (result.agentType === 'implementation') return;

	const input = result.agentInput as { repoFullName?: string };
	if (!input.repoFullName || !result.prNumber) return;

	let owner: string;
	let repo: string;
	try {
		({ owner, repo } = parseRepoFullName(input.repoFullName));
	} catch {
		return;
	}

	const { getSessionState } = await import('../../gadgets/sessionState.js');
	const { initialCommentId } = getSessionState();

	// Fall back to ackCommentId stored in agentInput if sessionState wasn't populated
	const ackCommentId =
		initialCommentId ?? (result.agentInput as { ackCommentId?: number }).ackCommentId ?? null;

	if (!ackCommentId) return;

	await safeOperation(() => githubClient.deletePRComment(owner, repo, ackCommentId), {
		action: 'delete progress comment after agent success',
		prNumber: result.prNumber,
	});
}

/**
 * Update the initial PR comment with an error message when the agent fails.
 */
export async function updateInitialCommentWithError(
	result: TriggerResult,
	agentResult: { success: boolean; error?: string },
): Promise<void> {
	const input = result.agentInput as { repoFullName?: string };
	if (!input.repoFullName || !result.prNumber) return;

	let owner: string;
	let repo: string;
	try {
		({ owner, repo } = parseRepoFullName(input.repoFullName));
	} catch {
		return;
	}

	const { getSessionState } = await import('../../gadgets/sessionState.js');
	const { initialCommentId } = getSessionState();
	if (!initialCommentId) return;

	const errorMessage = agentResult.error || 'Agent completed without making changes';
	const body = `⚠️ **${result.agentType} agent failed**\n\n${errorMessage}\n\n<sub>Manual intervention may be required.</sub>`;

	await safeOperation(() => githubClient.updatePRComment(owner, repo, initialCommentId, body), {
		action: 'update PR comment with error',
		prNumber: result.prNumber,
	});
}

/**
 * Post an acknowledgment comment on the PR.
 *
 * Generates an LLM-based ack message contextual to the event, falling back
 * to static INITIAL_MESSAGES on failure. Injects ackCommentId and ackMessage
 * into the result's agentInput so the agent can pre-seed its ProgressMonitor.
 */
export async function postAcknowledgmentComment(
	result: TriggerResult,
	payload: unknown,
	eventType: string,
	project: ProjectConfig,
): Promise<void> {
	if (!result.agentType || !result.prNumber) {
		return;
	}
	const input = result.agentInput as {
		repoFullName?: string;
	};
	if (!input.repoFullName) {
		return;
	}
	const { owner, repo } = parseRepoFullName(input.repoFullName);
	const prNumber = result.prNumber;

	let message: string;
	try {
		const context = extractGitHubContext(payload, eventType);
		message = await generateAckMessage(result.agentType, context, project.id);
	} catch {
		message = INITIAL_MESSAGES[result.agentType] ?? INITIAL_MESSAGES.implementation;
	}

	const comment = await safeOperation(
		() => githubClient.createPRComment(owner, repo, prNumber, message),
		{ action: 'post acknowledgment comment', prNumber },
	);
	if (comment) {
		result.agentInput.ackCommentId = comment.id;
		result.agentInput.ackMessage = message;
	}
}
