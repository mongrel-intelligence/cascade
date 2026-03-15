/**
 * Shared utility for checking whether the PM provider's backlog list is empty,
 * and whether the pipeline is at capacity (too many items in flight).
 *
 * Used by trigger handlers to skip running the backlog-manager agent when there
 * is nothing in the backlog to process (avoids costly LLM sessions for no reason),
 * or when the pipeline already has too many items in flight.
 *
 * Conservative fallback: if the PM API returns an error, the functions return
 * `false` (backlog is NOT empty / pipeline is NOT at capacity) so the agent
 * still runs normally.
 */

import { getJiraConfig, getTrelloConfig } from '../../pm/config.js';
import type { PMProvider } from '../../pm/types.js';
import type { ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';

// ---------------------------------------------------------------------------
// isPipelineAtCapacity
// ---------------------------------------------------------------------------

/**
 * Result returned by `isPipelineAtCapacity`.
 */
export interface PipelineCapacityResult {
	/** Whether the pipeline is at or above capacity (or the backlog is empty). */
	atCapacity: boolean;
	/**
	 * Human-readable reason for the capacity decision.
	 * - `'backlog-empty'` — no items in the backlog to pull in
	 * - `'at-capacity'` — in-flight item count >= limit
	 * - `'below-capacity'` — in-flight item count < limit
	 * - `'error'` — PM API error; conservative fallback applied (not at capacity)
	 * - `'misconfigured'` — required config fields missing; conservative fallback applied
	 */
	reason: 'backlog-empty' | 'at-capacity' | 'below-capacity' | 'error' | 'misconfigured';
	/** Number of items currently in flight (TODO + IN_PROGRESS + IN_REVIEW). */
	inFlightCount?: number;
	/** The effective capacity limit used for the comparison. */
	limit?: number;
}

/**
 * Returns whether the pipeline is at capacity.
 *
 * The pipeline is considered "at capacity" when:
 * 1. The backlog list is empty (nothing to pull in), OR
 * 2. The number of items across TODO + IN_PROGRESS + IN_REVIEW is >= `project.maxInFlightItems` (default 1)
 *
 * Conservative fallback: if the PM API returns an error, returns `{ atCapacity: false, reason: 'error' }`
 * so the caller allows the agent to run.
 *
 * Supports Trello and JIRA. For any other provider type, or when required config
 * fields are missing, returns `{ atCapacity: false, reason: 'misconfigured' }`.
 *
 * @param project - Resolved project configuration
 * @param provider - An initialised PM provider instance
 */
export async function isPipelineAtCapacity(
	project: ProjectConfig,
	provider: PMProvider,
): Promise<PipelineCapacityResult> {
	const limit = project.maxInFlightItems ?? 1;

	try {
		if (provider.type === 'trello') {
			return await checkTrelloCapacity(project, provider, limit);
		}

		if (provider.type === 'jira') {
			return await checkJiraCapacity(project, provider, limit);
		}

		logger.warn('isPipelineAtCapacity: unsupported PM provider type', {
			providerType: provider.type,
			projectId: project.id,
		});
		return { atCapacity: false, reason: 'misconfigured' };
	} catch (err) {
		logger.warn('isPipelineAtCapacity: failed to check capacity, assuming not at capacity', {
			projectId: project.id,
			error: String(err),
		});
		return { atCapacity: false, reason: 'error' };
	}
}

async function checkTrelloCapacity(
	project: ProjectConfig,
	provider: PMProvider,
	limit: number,
): Promise<PipelineCapacityResult> {
	const trelloConfig = getTrelloConfig(project);
	if (!trelloConfig) {
		logger.warn('isPipelineAtCapacity: no Trello config for project', {
			projectId: project.id,
		});
		return { atCapacity: false, reason: 'misconfigured' };
	}

	const { lists } = trelloConfig;

	// Step 1: Check if backlog is empty — no work to pull in
	const backlogListId = lists.backlog;
	if (!backlogListId) {
		logger.warn('isPipelineAtCapacity: no backlog list configured for Trello project', {
			projectId: project.id,
		});
		return { atCapacity: false, reason: 'misconfigured' };
	}

	const backlogItems = await provider.listWorkItems(backlogListId);
	if (backlogItems.length === 0) {
		logger.info('isPipelineAtCapacity: backlog is empty', { projectId: project.id });
		return { atCapacity: true, reason: 'backlog-empty', inFlightCount: 0, limit };
	}

	// Step 2: Count in-flight items (TODO + IN_PROGRESS + IN_REVIEW)
	const inFlightListIds = [lists.todo, lists.inProgress, lists.inReview].filter(
		(id): id is string => Boolean(id),
	);

	const inFlightCounts = await Promise.all(
		inFlightListIds.map((listId) => provider.listWorkItems(listId)),
	);
	const inFlightCount = inFlightCounts.reduce((sum, items) => sum + items.length, 0);

	if (inFlightCount >= limit) {
		logger.info('isPipelineAtCapacity: pipeline at capacity', {
			projectId: project.id,
			inFlightCount,
			limit,
		});
		return { atCapacity: true, reason: 'at-capacity', inFlightCount, limit };
	}

	return { atCapacity: false, reason: 'below-capacity', inFlightCount, limit };
}

async function checkJiraCapacity(
	project: ProjectConfig,
	provider: PMProvider,
	limit: number,
): Promise<PipelineCapacityResult> {
	const jiraConfig = getJiraConfig(project);
	const backlogStatus = jiraConfig?.statuses?.backlog;
	const projectKey = jiraConfig?.projectKey;

	if (!backlogStatus || !projectKey) {
		logger.warn(
			'isPipelineAtCapacity: no backlog status or projectKey configured for JIRA project',
			{ projectId: project.id },
		);
		return { atCapacity: false, reason: 'misconfigured' };
	}

	// Step 1: Check if backlog is empty — no work to pull in
	const backlogItems = await provider.listWorkItems(projectKey, { status: backlogStatus });
	if (backlogItems.length === 0) {
		logger.info('isPipelineAtCapacity: backlog is empty', { projectId: project.id });
		return { atCapacity: true, reason: 'backlog-empty', inFlightCount: 0, limit };
	}

	// Step 2: Count in-flight items across TODO + IN_PROGRESS + IN_REVIEW statuses
	const { statuses } = jiraConfig;
	const inFlightStatuses = [statuses.todo, statuses.inProgress, statuses.inReview].filter(
		(s): s is string => Boolean(s),
	);

	const inFlightCounts = await Promise.all(
		inFlightStatuses.map((status) => provider.listWorkItems(projectKey, { status })),
	);
	const inFlightCount = inFlightCounts.reduce((sum, items) => sum + items.length, 0);

	if (inFlightCount >= limit) {
		logger.info('isPipelineAtCapacity: pipeline at capacity', {
			projectId: project.id,
			inFlightCount,
			limit,
		});
		return { atCapacity: true, reason: 'at-capacity', inFlightCount, limit };
	}

	return { atCapacity: false, reason: 'below-capacity', inFlightCount, limit };
}

// ---------------------------------------------------------------------------
// isBacklogEmpty (deprecated)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use `isPipelineAtCapacity` instead.
 *
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
