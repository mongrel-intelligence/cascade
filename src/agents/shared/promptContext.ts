import { getJiraConfig, getTrelloConfig } from '../../pm/config.js';
import { getPMProviderOrNull } from '../../pm/index.js';
import type { ProjectConfig } from '../../types/index.js';
import type { PromptContext } from '../prompts/index.js';

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
): PromptContext {
	const pmProvider = getPMProviderOrNull();
	const isJira = pmProvider?.type === 'jira';
	return {
		workItemId,
		workItemUrl: workItemId && pmProvider ? pmProvider.getWorkItemUrl(workItemId) : undefined,
		projectId: project.id,
		baseBranch: project.baseBranch,
		backlogListId:
			getTrelloConfig(project)?.lists?.backlog ?? getJiraConfig(project)?.statuses?.backlog,
		todoListId: getTrelloConfig(project)?.lists?.todo ?? getJiraConfig(project)?.statuses?.todo,
		inProgressListId:
			getTrelloConfig(project)?.lists?.inProgress ?? getJiraConfig(project)?.statuses?.inProgress,
		inReviewListId:
			getTrelloConfig(project)?.lists?.inReview ?? getJiraConfig(project)?.statuses?.inReview,
		doneListId: getTrelloConfig(project)?.lists?.done ?? getJiraConfig(project)?.statuses?.done,
		mergedListId:
			getTrelloConfig(project)?.lists?.merged ?? getJiraConfig(project)?.statuses?.merged,
		processedLabelId: getTrelloConfig(project)?.labels?.processed,
		autoLabelId: getTrelloConfig(project)?.labels?.auto ?? getJiraConfig(project)?.labels?.auto,
		pmType: pmProvider?.type,
		workItemNoun: isJira ? 'issue' : 'card',
		workItemNounPlural: isJira ? 'issues' : 'cards',
		workItemNounCap: isJira ? 'Issue' : 'Card',
		workItemNounPluralCap: isJira ? 'Issues' : 'Cards',
		pmName: isJira ? 'JIRA' : 'Trello',
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
			debugListId: getTrelloConfig(project)?.lists?.debug,
		}),
	};
}
