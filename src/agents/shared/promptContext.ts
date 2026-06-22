import { getJiraConfig, getLinearConfig, getTrelloConfig } from '../../pm/config.js';
import { getPMProviderOrNull } from '../../pm/index.js';
import type { ProjectConfig } from '../../types/index.js';
import type { PromptContext } from '../prompts/index.js';

function getListIds(project: ProjectConfig) {
	const trelloConfig = getTrelloConfig(project);
	const jiraConfig = getJiraConfig(project);
	const linearConfig = getLinearConfig(project);
	const backlogStatusId =
		trelloConfig?.lists?.backlog ??
		jiraConfig?.statuses?.backlog ??
		linearConfig?.statuses?.backlog;
	const workItemCreateContainerId =
		trelloConfig?.lists?.backlog ?? jiraConfig?.projectKey ?? linearConfig?.teamId;

	return {
		// Value the agent should pass as `expectedSourceState` when moving an
		// item out of BACKLOG. It is the provider-native source state/list ID
		// where available, and is intentionally not Linear's team container.
		backlogSourceLabel: backlogStatusId ?? 'Backlog',
		backlogStatusId,
		workItemCreateContainerId,
		// Deprecated compatibility alias for older custom prompts. Built-in
		// prompts use backlogStatusId for listing/move guards and
		// workItemCreateContainerId for creation.
		backlogListId: backlogStatusId,
		todoListId:
			trelloConfig?.lists?.todo ?? jiraConfig?.statuses?.todo ?? linearConfig?.statuses?.todo,
		inProgressListId:
			trelloConfig?.lists?.inProgress ??
			jiraConfig?.statuses?.inProgress ??
			linearConfig?.statuses?.inProgress,
		inReviewListId:
			trelloConfig?.lists?.inReview ??
			jiraConfig?.statuses?.inReview ??
			linearConfig?.statuses?.inReview,
		doneListId:
			trelloConfig?.lists?.done ?? jiraConfig?.statuses?.done ?? linearConfig?.statuses?.done,
		mergedListId:
			trelloConfig?.lists?.merged ?? jiraConfig?.statuses?.merged ?? linearConfig?.statuses?.merged,
		debugListId: trelloConfig?.lists?.debug,
		processedLabelId: trelloConfig?.labels?.processed,
		autoLabelId:
			trelloConfig?.labels?.auto ?? jiraConfig?.labels?.auto ?? linearConfig?.labels?.auto,
	};
}

function getPromptTerminology(pmType: string | undefined) {
	const isJira = pmType === 'jira';
	const isLinear = pmType === 'linear';

	return {
		workItemNoun: isJira || isLinear ? 'issue' : 'card',
		workItemNounPlural: isJira || isLinear ? 'issues' : 'cards',
		workItemNounCap: isJira || isLinear ? 'Issue' : 'Card',
		workItemNounPluralCap: isJira || isLinear ? 'Issues' : 'Cards',
		pmName: isJira ? 'JIRA' : isLinear ? 'Linear' : 'Trello',
	};
}

/**
 * Build a PromptContext from project config and optional trigger data.
 *
 * Shared by the llmist agent lifecycle (agents/base.ts) and the adapter
 * (backends/adapter.ts) so both backends use consistent prompt context
 * building logic including PM-type normalization and work item noun i18n.
 *
 * @param alertingResultsContainerId - Optional PM container ID from Sentry integration config.
 *   Used as a fallback creation container when no PM backlog is configured on the project.
 *   Populated by `secretOrchestrator` for alerting agent runs.
 */
export function buildPromptContext(
	workItemId: string | undefined,
	project: ProjectConfig,
	triggerType?: string,
	prContext?: { prNumber: number; prBranch: string; repoFullName: string; headSha: string },
	debugContext?: {
		logDir: string;
		originalWorkItemId: string;
		originalWorkItemName: string;
		originalWorkItemUrl: string;
		detectedAgentType: string;
	},
	alertingResultsContainerId?: string,
): PromptContext {
	// An SCM-only project has NO_PM_PROVIDER (type 'none') in scope. Normalize it to
	// `null` once so the whole context build treats it as "no PM provider" — otherwise
	// the truthy sentinel reaches getWorkItemUrl() below (when a workItemId is carried
	// via a stale pr_work_items row or a manual/retry path) and throws during boot.
	const rawPmProvider = getPMProviderOrNull();
	const pmProvider = rawPmProvider?.type === 'none' ? null : rawPmProvider;
	const listIds = getListIds(project);
	const terminology = getPromptTerminology(pmProvider?.type);

	// Fall back to the Sentry-configured results container when no PM backlog/create container is set.
	const backlogListId = listIds.backlogListId ?? alertingResultsContainerId;
	const workItemCreateContainerId = listIds.workItemCreateContainerId ?? alertingResultsContainerId;

	return {
		workItemId,
		workItemUrl: workItemId && pmProvider ? pmProvider.getWorkItemUrl(workItemId) : undefined,
		projectId: project.id,
		baseBranch: project.baseBranch,
		...listIds,
		backlogListId,
		workItemCreateContainerId,
		pmType: pmProvider && pmProvider.type !== 'none' ? pmProvider.type : undefined,
		...terminology,
		maxInFlightItems: project.maxInFlightItems ?? 1,
		...(prContext && {
			prNumber: prContext.prNumber,
			prBranch: prContext.prBranch,
			repoFullName: prContext.repoFullName,
			headSha: prContext.headSha,
			triggerType,
		}),
		...(debugContext && {
			logDir: debugContext.logDir,
			originalWorkItemId: debugContext.originalWorkItemId,
			originalWorkItemName: debugContext.originalWorkItemName,
			originalWorkItemUrl: debugContext.originalWorkItemUrl,
			detectedAgentType: debugContext.detectedAgentType,
			debugListId: listIds.debugListId,
		}),
	};
}
