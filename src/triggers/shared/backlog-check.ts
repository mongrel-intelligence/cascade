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

import { getJiraConfig, getLinearConfig, getTrelloConfig } from '../../pm/config.js';
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
/**
 * Compile-time exhaustiveness guard. The `default` branch of the switch in
 * `isProviderMisconfigured` calls this with `provider.type` narrowed to
 * `never` — TypeScript only allows that when every `PMType` member has its
 * own case. Adding a 4th provider without a matching case becomes a compile
 * error, not a silent runtime "misconfigured".
 */
function assertNeverPMType(t: never): never {
	throw new Error(`Unhandled PMType in isProviderMisconfigured: ${String(t)}`);
}

/**
 * Detect missing/incomplete provider config so we can return `'misconfigured'`
 * (conservative fallback: agent runs anyway) instead of silently treating it as
 * an empty backlog (which would skip the agent run). This is the *only* part of
 * isPipelineAtCapacity that needs per-provider awareness — the actual queries
 * go through the unified `provider.listWorkItems(undefined, { status })` path.
 */
function isProviderMisconfigured(project: ProjectConfig, provider: PMProvider): boolean {
	switch (provider.type) {
		case 'trello':
			return !getTrelloConfig(project)?.lists?.backlog;
		case 'jira': {
			const jira = getJiraConfig(project);
			return !jira?.projectKey || !jira.statuses?.backlog;
		}
		case 'linear': {
			const linear = getLinearConfig(project);
			return !linear?.teamId || !linear.statuses?.backlog;
		}
		default:
			return assertNeverPMType(provider.type);
	}
}

export async function isPipelineAtCapacity(
	project: ProjectConfig,
	provider: PMProvider,
): Promise<PipelineCapacityResult> {
	const limit = project.maxInFlightItems ?? 1;

	if (isProviderMisconfigured(project, provider)) {
		logger.warn('isPipelineAtCapacity: provider config incomplete for backlog check', {
			providerType: provider.type,
			projectId: project.id,
		});
		return { atCapacity: false, reason: 'misconfigured' };
	}

	try {
		// Unified path: each provider self-resolves the natural scope
		// (Trello list / JIRA project / Linear team) from its config when
		// containerId is undefined. The status filter is the CASCADE-canonical
		// key, mapped to the provider's native identifier internally.
		const backlogItems = await provider.listWorkItems(undefined, { status: 'backlog' });
		if (backlogItems.length === 0) {
			logger.info('isPipelineAtCapacity: backlog is empty', { projectId: project.id });
			return { atCapacity: true, reason: 'backlog-empty', inFlightCount: 0, limit };
		}

		const inFlightLists = await Promise.all(
			(['todo', 'inProgress', 'inReview'] as const).map((status) =>
				provider.listWorkItems(undefined, { status }),
			),
		);
		const inFlightCount = inFlightLists.reduce((sum, items) => sum + items.length, 0);

		if (inFlightCount >= limit) {
			logger.info('isPipelineAtCapacity: pipeline at capacity', {
				projectId: project.id,
				inFlightCount,
				limit,
			});
			return { atCapacity: true, reason: 'at-capacity', inFlightCount, limit };
		}

		return { atCapacity: false, reason: 'below-capacity', inFlightCount, limit };
	} catch (err) {
		logger.warn('isPipelineAtCapacity: failed to check capacity, assuming not at capacity', {
			projectId: project.id,
			error: String(err),
		});
		return { atCapacity: false, reason: 'error' };
	}
}
