import { getJiraConfig, getTrelloConfig } from '../../pm/config.js';
import { getPMProviderOrNull } from '../../pm/index.js';
import type { ProjectConfig } from '../../types/index.js';
import { resolveSquintDbPath } from '../../utils/squintDb.js';
import type { PromptContext } from '../prompts/index.js';

function getListIds(project: ProjectConfig) {
	const trelloConfig = getTrelloConfig(project);
	const jiraConfig = getJiraConfig(project);

	return {
		backlogListId: trelloConfig?.lists?.backlog ?? jiraConfig?.statuses?.backlog,
		todoListId: trelloConfig?.lists?.todo ?? jiraConfig?.statuses?.todo,
		inProgressListId: trelloConfig?.lists?.inProgress ?? jiraConfig?.statuses?.inProgress,
		inReviewListId: trelloConfig?.lists?.inReview ?? jiraConfig?.statuses?.inReview,
		doneListId: trelloConfig?.lists?.done ?? jiraConfig?.statuses?.done,
		mergedListId: trelloConfig?.lists?.merged ?? jiraConfig?.statuses?.merged,
		debugListId: trelloConfig?.lists?.debug,
		processedLabelId: trelloConfig?.labels?.processed,
		autoLabelId: trelloConfig?.labels?.auto ?? jiraConfig?.labels?.auto,
	};
}

function getPromptTerminology(pmType: string | undefined) {
	const isJira = pmType === 'jira';

	return {
		workItemNoun: isJira ? 'issue' : 'card',
		workItemNounPlural: isJira ? 'issues' : 'cards',
		workItemNounCap: isJira ? 'Issue' : 'Card',
		workItemNounPluralCap: isJira ? 'Issues' : 'Cards',
		pmName: isJira ? 'JIRA' : 'Trello',
	};
}

/**
 * Build a PromptContext from project config and optional trigger data.
 *
 * Shared by the llmist agent lifecycle (agents/base.ts) and the adapter
 * (backends/adapter.ts) so both backends use consistent prompt context
 * building logic including PM-type normalization and work item noun i18n.
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
	repoDir?: string,
): PromptContext {
	const pmProvider = getPMProviderOrNull();
	const listIds = getListIds(project);
	const terminology = getPromptTerminology(pmProvider?.type);
	const squintEnabled = repoDir ? resolveSquintDbPath(repoDir) !== null : false;

	return {
		workItemId,
		workItemUrl: workItemId && pmProvider ? pmProvider.getWorkItemUrl(workItemId) : undefined,
		projectId: project.id,
		baseBranch: project.baseBranch,
		...listIds,
		pmType: pmProvider?.type,
		...terminology,
		maxInFlightItems: project.maxInFlightItems ?? 1,
		squintEnabled,
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
