/**
 * Shared utility for checking whether the PM provider's backlog list is empty.
 *
 * Used by trigger handlers to skip running the backlog-manager agent when there
 * is nothing in the backlog to process (avoids costly LLM sessions for no reason).
 *
 * Conservative fallback: if the PM API returns an error, the function returns
 * `false` (backlog is NOT empty) so the agent still runs normally.
 */

import { getJiraConfig, getTrelloConfig } from '../../pm/config.js';
import type { PMProvider } from '../../pm/types.js';
import type { ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';

/**
 * Returns `true` when the project's backlog list/queue is empty.
 *
 * Supports Trello and JIRA.  For any other provider type, or when required
 * config fields are missing, returns `false` (conservative: let the agent run).
 *
 * @param project - Resolved project configuration
 * @param provider - An initialised PM provider instance
 */
export async function isBacklogEmpty(
	project: ProjectConfig,
	provider: PMProvider,
): Promise<boolean> {
	try {
		if (provider.type === 'trello') {
			const backlogListId = getTrelloConfig(project)?.lists?.backlog;
			if (!backlogListId) {
				logger.warn('isBacklogEmpty: no backlog list configured for Trello project', {
					projectId: project.id,
				});
				return false;
			}
			const items = await provider.listWorkItems(backlogListId);
			return items.length === 0;
		}

		if (provider.type === 'jira') {
			const jiraConfig = getJiraConfig(project);
			const backlogStatus = jiraConfig?.statuses?.backlog;
			const projectKey = jiraConfig?.projectKey;
			if (!backlogStatus || !projectKey) {
				logger.warn('isBacklogEmpty: no backlog status or projectKey configured for JIRA project', {
					projectId: project.id,
				});
				return false;
			}
			const items = await provider.listWorkItems(projectKey, { status: backlogStatus });
			return items.length === 0;
		}

		logger.warn('isBacklogEmpty: unsupported PM provider type', {
			providerType: provider.type,
			projectId: project.id,
		});
		return false;
	} catch (err) {
		logger.warn('isBacklogEmpty: failed to check backlog, assuming non-empty', {
			projectId: project.id,
			error: String(err),
		});
		return false;
	}
}
