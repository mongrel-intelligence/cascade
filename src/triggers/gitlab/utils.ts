/**
 * Shared utilities for GitLab trigger handlers.
 *
 * Mirrors the GitHub utils pattern — author mode evaluation and work item resolution.
 */

import { lookupWorkItemForPR } from '../../db/repositories/prWorkItemsRepository.js';
import type { PersonaIdentities } from '../../github/personas.js';
import { gitlabClient } from '../../gitlab/client.js';
import { logger } from '../../utils/logging.js';
import type { GitLabPipelinePayload } from './types.js';

export interface AuthorModeResult {
	shouldTrigger: boolean;
	authorMode: string;
	isImplementerMR: boolean;
}

/**
 * Evaluate whether a trigger should fire based on the MR author and the
 * configured `authorMode` parameter.
 *
 * Returns `null` when personaIdentities is missing (caller should return null).
 * Validates authorMode against known values and falls back to 'own'.
 */
export function evaluateAuthorMode(
	mrAuthorUsername: string,
	personaIdentities: PersonaIdentities | undefined,
	parameters: Record<string, unknown>,
	handlerName: string,
): AuthorModeResult | null {
	if (!personaIdentities) {
		logger.info('No persona identities available, skipping', { handler: handlerName });
		return null;
	}
	const implLogin = personaIdentities.implementer;
	const isImplementerMR =
		mrAuthorUsername === implLogin || mrAuthorUsername === `${implLogin}[bot]`;

	const rawMode = parameters.authorMode;
	const authorMode =
		typeof rawMode === 'string' && ['own', 'external', 'all'].includes(rawMode) ? rawMode : 'own';

	if (typeof rawMode === 'string' && authorMode !== rawMode) {
		logger.warn('Invalid authorMode value, falling back to "own"', {
			handler: handlerName,
			configuredValue: rawMode,
		});
	}

	const shouldTrigger =
		authorMode === 'all' ||
		(authorMode === 'own' && isImplementerMR) ||
		(authorMode === 'external' && !isImplementerMR);

	return { shouldTrigger, authorMode, isImplementerMR };
}

/**
 * Resolve work item ID for a MR using DB lookup only (pr_work_items table).
 * Returns undefined when DB returns null or throws.
 *
 * GitLab MR IIDs are project-scoped (like GitHub PR numbers), so the same
 * pr_work_items table and lookup function works for both platforms.
 */
export async function resolveWorkItemId(
	projectId: string,
	mrIid: number,
): Promise<string | undefined> {
	try {
		const dbResult = await lookupWorkItemForPR(projectId, mrIid);
		if (dbResult) return dbResult;
	} catch (err) {
		logger.warn('Failed to look up work item from DB', {
			projectId,
			mrIid,
			error: String(err),
		});
	}

	return undefined;
}

/**
 * Resolve merge request info for a pipeline payload.
 *
 * GitLab only populates `merge_request` in Pipeline Hook payloads when the
 * pipeline runs in a merge-request context (e.g. `source: "merge_request_event"`).
 * Branch pushes (`source: "push"`) have `merge_request: null` even when an
 * open MR exists for the branch.
 *
 * This helper checks the payload first, then falls back to querying the
 * GitLab API for an open MR matching the pipeline's ref (branch name).
 */
export async function resolveMergeRequestForPipeline(
	payload: GitLabPipelinePayload,
): Promise<GitLabPipelinePayload['merge_request'] | null> {
	// If GitLab already included the MR, use it
	if (payload.merge_request) return payload.merge_request;

	// Look up open MR by source branch
	const ref = payload.object_attributes.ref;
	const projectPath = payload.project.path_with_namespace;

	try {
		const mr = await gitlabClient.getOpenMRByBranch(projectPath, ref);
		if (!mr) return null;

		// Fetch full MR details to get target_branch, state, etc.
		const details = await gitlabClient.getMR(projectPath, mr.iid);
		return {
			iid: details.iid,
			title: details.title,
			url: details.webUrl,
			source_branch: details.sourceBranch,
			target_branch: details.targetBranch,
			state: details.state,
		};
	} catch (err) {
		logger.debug('Failed to look up MR for pipeline branch', {
			ref,
			projectPath,
			error: String(err),
		});
		return null;
	}
}
