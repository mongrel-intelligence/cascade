/**
 * GitHub token resolution for router-side acknowledgment comment posting.
 *
 * Extracted from `acknowledgments.ts` to keep that module focused on ack CRUD.
 * The GitHub adapter (`adapters/github.ts`) is the primary consumer, but this
 * is also re-exported through `acknowledgments.ts` for backward compatibility
 * with any external callers.
 */

import { getProjectGitHubToken } from '../config/projects.js';
import { findProjectByRepo, getIntegrationCredential } from '../config/provider.js';
import type { ProjectConfig } from '../types/index.js';
import { logger } from '../utils/logging.js';

/** Return type for resolved GitHub credentials */
export interface ResolvedGitHubToken {
	token: string;
	project: ProjectConfig;
}

/**
 * Resolve a GitHub token for posting ack comments from the router.
 * Uses the implementer token since ack comments are "from" the bot.
 */
export async function resolveGitHubTokenForAck(
	repoFullName: string,
): Promise<ResolvedGitHubToken | null> {
	const project = await findProjectByRepo(repoFullName);
	if (!project) return null;

	try {
		const token = await getProjectGitHubToken(project);
		return { token, project };
	} catch {
		logger.warn('[Ack] Missing GitHub token for repo:', repoFullName);
		return null;
	}
}

/**
 * Resolve a persona-appropriate GitHub token for ack comments.
 * Returns the reviewer token for `review` agents so the ack comment
 * is posted by the same persona that will run the agent (and can
 * later update it via ProgressMonitor). All other agents use the
 * implementer token.
 *
 * @param project — Optional pre-resolved project config. When provided, the
 *   `findProjectByRepo()` DB lookup is skipped entirely (eliminating a
 *   redundant query in callers that have already resolved the project).
 */
export async function resolveGitHubTokenForAckByAgent(
	repoFullName: string,
	agentType: string,
	project?: ProjectConfig,
): Promise<ResolvedGitHubToken | null> {
	const resolvedProject = project ?? (await findProjectByRepo(repoFullName));
	if (!resolvedProject) return null;

	try {
		if (agentType === 'review') {
			const token = await getIntegrationCredential(resolvedProject.id, 'scm', 'reviewer_token');
			return { token, project: resolvedProject };
		}
		const token = await getProjectGitHubToken(resolvedProject);
		return { token, project: resolvedProject };
	} catch {
		logger.warn('[Ack] Missing GitHub token for repo:', repoFullName);
		return null;
	}
}
