import { createWorkItem, linkPRToWorkItem } from '../../db/repositories/prWorkItemsRepository.js';
import { updateRunPRNumber } from '../../db/repositories/runsRepository.js';
import type { AgentInput, AgentResult, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { extractPRNumber } from '../../utils/prUrl.js';
import { parseRepoFullName } from '../../utils/repo.js';
import type { TriggerResult } from '../types.js';

export interface ResolvedAgentWorkItem {
	workItemId: string | undefined;
	agentInput: AgentInput;
}

export async function resolveWorkItemId(
	workItemId: string | undefined,
	projectId: string,
	prNumber: number | undefined,
): Promise<string | undefined> {
	if (workItemId) return workItemId;
	if (!prNumber) return undefined;

	try {
		const { lookupWorkItemForPR } = await import('../../db/repositories/prWorkItemsRepository.js');
		return (await lookupWorkItemForPR(projectId, prNumber)) ?? undefined;
	} catch (err) {
		logger.warn('Failed to resolve workItemId for PR', {
			projectId,
			prNumber,
			error: String(err),
		});
		return undefined;
	}
}

export async function prepareAgentWorkItem(
	result: TriggerResult,
	projectId: string,
): Promise<ResolvedAgentWorkItem> {
	const workItemId = await resolveWorkItemId(result.workItemId, projectId, result.prNumber);
	let agentInput =
		workItemId && result.agentInput.workItemId !== workItemId
			? { ...result.agentInput, workItemId }
			: result.agentInput;

	// Merge top-level TriggerResult URL/title metadata into agentInput when absent.
	// Several GitHub trigger handlers (PRReviewSubmittedTrigger, PROpenedTrigger,
	// ReviewRequestedTrigger, PRCommentMentionTrigger) set prUrl/prTitle/workItemUrl/
	// workItemTitle only at the TriggerResult top level without mirroring them into
	// agentInput. Both injectAgentInputContext (secretBuilder.ts) and LlmistEngine read
	// from agentInput, so we centralize the merge here before agent execution rather
	// than patching every handler individually.
	const extras: Partial<AgentInput> = {};
	if (result.prUrl && !agentInput.prUrl) extras.prUrl = result.prUrl;
	if (result.prTitle && !agentInput.prTitle) extras.prTitle = result.prTitle;
	if (result.workItemUrl && !agentInput.workItemUrl) extras.workItemUrl = result.workItemUrl;
	if (result.workItemTitle && !agentInput.workItemTitle)
		extras.workItemTitle = result.workItemTitle;

	if (Object.keys(extras).length > 0) {
		agentInput = { ...agentInput, ...extras };
	}

	return { workItemId, agentInput };
}

export async function persistPreRunWorkItems(
	result: TriggerResult,
	project: ProjectConfig,
	workItemId: string | undefined,
): Promise<void> {
	if (workItemId) {
		try {
			await createWorkItem(project.id, workItemId, {
				workItemUrl: result.workItemUrl,
				workItemTitle: result.workItemTitle,
			});
		} catch (err) {
			logger.warn('Failed to persist work-item row for PM-triggered run', {
				projectId: project.id,
				workItemId,
				error: String(err),
			});
		}
	}

	if (result.prNumber && project.repo) {
		try {
			await linkPRToWorkItem(project.id, project.repo, result.prNumber, workItemId ?? null, {
				workItemUrl: result.workItemUrl,
				workItemTitle: result.workItemTitle,
				prUrl: result.prUrl,
				prTitle: result.prTitle,
			});
		} catch (err) {
			logger.warn('Failed to ensure pr_work_items entry for PR-triggered run', {
				projectId: project.id,
				prNumber: result.prNumber,
				workItemId,
				error: String(err),
			});
		}
	}
}

export async function linkPRPostExecution(
	agentResult: AgentResult & { prUrl: string },
	project: ProjectConfig & { repo: string },
	result: TriggerResult,
	workItemId: string | undefined,
): Promise<void> {
	const prNumber = extractPRNumber(agentResult.prUrl);
	if (!prNumber) return;

	let prTitle: string | undefined;
	try {
		const { githubClient } = await import('../../github/client.js');
		const { owner, repo } = parseRepoFullName(project.repo);
		const pr = await githubClient.getPR(owner, repo, prNumber);
		prTitle = pr.title;
	} catch (err) {
		logger.warn('Failed to fetch PR title from GitHub', {
			projectId: project.id,
			prNumber,
			error: String(err),
		});
	}

	try {
		await linkPRToWorkItem(project.id, project.repo, prNumber, workItemId ?? null, {
			prUrl: agentResult.prUrl,
			prTitle,
			workItemUrl: result.workItemUrl,
			workItemTitle: result.workItemTitle,
		});
	} catch (err) {
		logger.warn('Failed to link PR to work item post-execution', {
			projectId: project.id,
			prNumber,
			workItemId,
			error: String(err),
		});
	}

	if (agentResult.runId) {
		try {
			await updateRunPRNumber(agentResult.runId, prNumber);
		} catch (err) {
			logger.warn('Failed to backfill prNumber on run', {
				runId: agentResult.runId,
				prNumber,
				error: String(err),
			});
		}
	}
}
