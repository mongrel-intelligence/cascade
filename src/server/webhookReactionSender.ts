/**
 * Unified fire-and-forget reaction sender for webhook endpoints.
 *
 * Replaces the three platform-specific builders
 * (`buildTrelloReactionSender`, `buildGitHubReactionSender`,
 * `buildJiraReactionSender`) with a single `buildReactionSender` factory
 * that dispatches to `sendAcknowledgeReaction` based on the webhook source.
 *
 * Platform-specific event filtering and project resolution live here so
 * that the caller (server.ts) only needs one import and one call per
 * webhook route.
 */

import { findProjectByRepo } from '../config/provider.js';
import { resolvePersonaIdentities } from '../github/personas.js';
import { sendAcknowledgeReaction } from '../router/reactions.js';
import type { CascadeConfig } from '../types/index.js';
import { logger } from '../utils/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReactionSender = (payload: unknown, eventType: string | undefined) => void;

// ---------------------------------------------------------------------------
// Internal platform helpers
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget Trello reaction.
 * Only reacts on `commentCard` events.
 */
function trelloReactionSender(config: CascadeConfig): ReactionSender {
	return (payload, eventType) => {
		if (eventType !== 'commentCard') return;
		const boardId = (payload as Record<string, Record<string, unknown>>).model?.id as
			| string
			| undefined;
		const project = config.projects.find((p) => p.trello?.boardId === boardId);
		if (!project) return;
		void sendAcknowledgeReaction('trello', project.id, payload).catch((err) =>
			logger.error('[Server] Trello reaction error:', { error: String(err) }),
		);
	};
}

/**
 * Fire-and-forget GitHub reaction.
 * Only reacts on `issue_comment` or `pull_request_review_comment` events.
 */
function gitHubReactionSender(): ReactionSender {
	return (payload, eventType) => {
		if (eventType !== 'issue_comment' && eventType !== 'pull_request_review_comment') return;
		const repoFullName = (
			(payload as Record<string, unknown>)?.repository as Record<string, unknown>
		)?.full_name as string | undefined;
		if (!repoFullName) return;
		void (async () => {
			try {
				const project = await findProjectByRepo(repoFullName);
				if (!project) {
					logger.warn('[Server] No project found for repo, skipping GitHub reaction', {
						repoFullName,
					});
					return;
				}
				const personaIdentities = await resolvePersonaIdentities(project.id);
				await sendAcknowledgeReaction('github', repoFullName, payload, personaIdentities, project);
			} catch (err) {
				logger.error('[Server] GitHub reaction error:', { error: String(err) });
			}
		})();
	};
}

/**
 * Fire-and-forget JIRA reaction.
 * Only reacts on events whose name starts with `comment_`.
 */
function jiraReactionSender(config: CascadeConfig): ReactionSender {
	return (payload, eventType) => {
		if (!eventType?.startsWith('comment_')) return;
		const jiraProjectKey = (
			((payload as Record<string, unknown>)?.issue as Record<string, unknown>)?.fields as Record<
				string,
				unknown
			>
		)?.project as Record<string, unknown> | undefined;
		const projectKey = jiraProjectKey?.key as string | undefined;
		const project = projectKey
			? config.projects.find((p) => p.jira?.projectKey === projectKey)
			: undefined;
		if (!project) return;
		void sendAcknowledgeReaction('jira', project.id, payload).catch((err) =>
			logger.error('[Server] JIRA reaction error:', { error: String(err) }),
		);
	};
}

// ---------------------------------------------------------------------------
// Unified factory
// ---------------------------------------------------------------------------

/**
 * Build a fire-and-forget reaction sender for the given webhook source.
 *
 * - `'trello'` — reacts on `commentCard` events; needs `config` for project lookup.
 * - `'github'` — reacts on `issue_comment` / `pull_request_review_comment` events;
 *   resolves the project dynamically via `findProjectByRepo`.
 * - `'jira'`   — reacts on `comment_*` events; needs `config` for project lookup.
 *
 * The returned function is safe to call fire-and-forget: all errors are caught
 * and logged internally.
 */
export function buildReactionSender(source: string, config?: CascadeConfig): ReactionSender {
	switch (source) {
		case 'trello': {
			if (!config) throw new Error('buildReactionSender: config required for trello');
			return trelloReactionSender(config);
		}
		case 'github': {
			return gitHubReactionSender();
		}
		case 'jira': {
			if (!config) throw new Error('buildReactionSender: config required for jira');
			return jiraReactionSender(config);
		}
		default:
			// Unknown source — return a no-op reaction sender for forward compatibility
			return () => {};
	}
}
