import { getJiraConfig, getLinearConfig, getTrelloConfig } from '../../pm/config.js';
import { getPMProviderOrNull } from '../../pm/index.js';
import type { ProjectConfig } from '../../types/index.js';
import type { PromptContext } from '../prompts/index.js';

function getListIds(project: ProjectConfig) {
	const trelloConfig = getTrelloConfig(project);
	const jiraConfig = getJiraConfig(project);
	const linearConfig = getLinearConfig(project);

	return {
		// Value the agent should pass as `expectedSourceState` when moving an
		// item out of BACKLOG. Aligned with what `WorkItem.status` returns
		// per provider:
		//   - Trello: `WorkItem.status` is the list ID → pass list ID.
		//   - JIRA:   `WorkItem.status` is the status name → pass status name.
		//   - Linear: `WorkItem.status` is the workflow-state name → pass the
		//             state name. Linear teams default to literal "Backlog";
		//             customized teams can still pass it via the prompt path
		//             since the gadget guard is case-insensitive.
		backlogSourceLabel: trelloConfig?.lists?.backlog ?? jiraConfig?.statuses?.backlog ?? 'Backlog',
		backlogListId:
			trelloConfig?.lists?.backlog ?? jiraConfig?.statuses?.backlog ?? linearConfig?.teamId,
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
 *   Used as a fallback `backlogListId` when no PM backlog is configured on the project.
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
	const pmProvider = getPMProviderOrNull();
	const listIds = getListIds(project);
	const terminology = getPromptTerminology(pmProvider?.type);

	// Fall back to the Sentry-configured results container when no PM backlog is set.
	const backlogListId = listIds.backlogListId ?? alertingResultsContainerId;

	return {
		workItemId,
		workItemUrl: workItemId && pmProvider ? pmProvider.getWorkItemUrl(workItemId) : undefined,
		projectId: project.id,
		baseBranch: project.baseBranch,
		...listIds,
		backlogListId,
		pmType: pmProvider?.type,
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
