/**
 * GitLabRouterAdapter — platform-specific logic for the router-side
 * GitLab webhook processing pipeline.
 *
 * Follows the same `RouterPlatformAdapter` pattern as the GitHub adapter
 * but tailored for GitLab webhook events (Merge Request Hook, Note Hook,
 * Pipeline Hook, Push Hook).
 */

import { getIntegrationCredential } from '../../config/provider.js';
import { withGitLabToken } from '../../gitlab/client.js';
import {
	isCascadeBot,
	type PersonaIdentities,
	resolvePersonaIdentities,
} from '../../gitlab/personas.js';
import { withPMCredentials, withPMProvider } from '../../pm/context.js';
import { pmRegistry } from '../../pm/registry.js';
import type { TriggerRegistry } from '../../triggers/registry.js';
import type { TriggerContext, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { loadProjectConfig, type RouterProjectConfig } from '../config.js';
import type { AckResult, ParsedWebhookEvent, RouterPlatformAdapter } from '../platform-adapter.js';
import { GitLabPlatformClient } from '../platformClients/gitlab.js';
import type { CascadeJob, GitLabJob } from '../queue.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** GitLab event types that CASCADE can process. */
const PROCESSABLE_EVENTS = ['Merge Request Hook', 'Note Hook', 'Pipeline Hook', 'Push Hook'];

// ---------------------------------------------------------------------------
// Parsed event — extends the base with GitLab-specific fields
// ---------------------------------------------------------------------------

interface GitLabParsedEvent extends ParsedWebhookEvent {
	/** GitLab project path (e.g. "group/subgroup/repo"). */
	projectPath: string;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class GitLabRouterAdapter implements RouterPlatformAdapter {
	readonly type = 'gitlab' as const;

	async parseWebhook(payload: unknown): Promise<GitLabParsedEvent | null> {
		const p = payload as Record<string, unknown>;
		const eventType = (p._eventType as string) || 'unknown';

		if (!PROCESSABLE_EVENTS.includes(eventType)) return null;

		// GitLab sends project info at payload.project.path_with_namespace
		const project = p.project as Record<string, unknown> | undefined;
		const projectPath = (project?.path_with_namespace as string) || 'unknown';

		const isCommentEvent = eventType === 'Note Hook';

		// Extract MR IID if available
		let workItemId: string | undefined;
		const objectAttributes = p.object_attributes as Record<string, unknown> | undefined;
		if (eventType === 'Merge Request Hook' && objectAttributes?.iid) {
			workItemId = String(objectAttributes.iid);
		} else if (eventType === 'Note Hook') {
			const mr = p.merge_request as Record<string, unknown> | undefined;
			if (mr?.iid) workItemId = String(mr.iid);
		} else if (eventType === 'Pipeline Hook') {
			const mr = p.merge_request as Record<string, unknown> | undefined;
			if (mr?.iid) workItemId = String(mr.iid);
		}

		return {
			projectIdentifier: projectPath,
			eventType,
			workItemId,
			isCommentEvent,
			projectPath,
		};
	}

	isProcessableEvent(event: ParsedWebhookEvent): boolean {
		return PROCESSABLE_EVENTS.includes(event.eventType);
	}

	async isSelfAuthored(event: ParsedWebhookEvent, payload: unknown): Promise<boolean> {
		// Only relevant for comment (Note Hook) events. GitLab sends the note
		// author at payload.user.username.
		if (!event.isCommentEvent) return false;
		const p = payload as Record<string, unknown>;
		const user = p.user as Record<string, unknown> | undefined;
		const username = user?.username as string | undefined;
		if (!username) return false;

		// Resolve the project's persona identities and check whether the note
		// author is one of the CASCADE bots. Without this, the implementer
		// persona's own MR notes re-trigger mr-comment-mention → comment loop.
		try {
			const projectPath = (event as GitLabParsedEvent).projectPath;
			const config = await loadProjectConfig();
			const fullProject = config.fullProjects.find((fp) => fp.repo === projectPath);
			if (!fullProject) return false;
			const personas = await resolvePersonaIdentities(fullProject.id);
			return isCascadeBot(username, personas);
		} catch {
			return false;
		}
	}

	sendReaction(_event: ParsedWebhookEvent, _payload: unknown): void {
		// GitLab emoji reactions could be implemented here in the future.
		// For now, no-op.
	}

	async resolveProject(event: ParsedWebhookEvent): Promise<RouterProjectConfig | null> {
		const projectPath = (event as GitLabParsedEvent).projectPath;
		const config = await loadProjectConfig();
		// Match by GitLab project path stored in the project's repo field
		return config.projects.find((p) => p.repo === projectPath) ?? null;
	}

	async dispatchWithCredentials(
		event: ParsedWebhookEvent,
		payload: unknown,
		_project: RouterProjectConfig,
		triggerRegistry: TriggerRegistry,
	): Promise<TriggerResult | null> {
		const projectPath = (event as GitLabParsedEvent).projectPath;
		const config = await loadProjectConfig();
		const fullProject = config.fullProjects.find((fp) => fp.repo === projectPath);
		if (!fullProject) {
			logger.info('No project for GitLab path, skipping dispatch', { projectPath });
			return null;
		}

		// Resolve persona identities for author-mode checks in triggers
		let personaIdentities: PersonaIdentities | undefined;
		try {
			personaIdentities = await resolvePersonaIdentities(fullProject.id);
		} catch (err) {
			logger.warn('Failed to resolve GitLab persona identities', {
				projectId: fullProject.id,
				error: String(err),
			});
		}

		const gitlabToken = await getIntegrationCredential(
			fullProject.id,
			'scm',
			'gitlab',
			'implementer_token',
		);
		const pmProvider = pmRegistry.createProvider(fullProject);

		const ctx: TriggerContext = {
			project: fullProject,
			source: 'gitlab',
			payload,
			personaIdentities,
		};

		return withPMCredentials(
			fullProject.id,
			fullProject.pm?.type,
			(t) => pmRegistry.getOrNull(t),
			() =>
				withPMProvider(pmProvider, () =>
					withGitLabToken(gitlabToken, () => triggerRegistry.dispatch(ctx)),
				),
		);
	}

	async postAck(
		event: ParsedWebhookEvent,
		_payload: unknown,
		project: RouterProjectConfig,
		agentType: string,
		_triggerResult?: TriggerResult,
	): Promise<AckResult | undefined> {
		try {
			const mrIid = event.workItemId;
			if (!mrIid) return undefined;

			const projectPath = (event as GitLabParsedEvent).projectPath;
			let token: string;
			try {
				token = await getIntegrationCredential(project.id, 'scm', 'gitlab', 'implementer_token');
			} catch {
				logger.warn('GitLab ack: missing implementer_token, skipping', {
					projectId: project.id,
				});
				return undefined;
			}

			// Default to gitlab.com; self-hosted instances would need host
			// configuration via integration config (resolved at the DB level).
			const host = 'https://gitlab.com';

			const client = new GitLabPlatformClient(projectPath, token, host);
			const message = `CASCADE \`${agentType}\` agent is processing this merge request...`;
			const noteId = await client.postComment(Number(mrIid), message);
			if (noteId != null) return { commentId: noteId, message };
		} catch (err) {
			logger.warn('GitLab ack comment failed (non-fatal)', { error: String(err) });
		}
		return undefined;
	}

	buildJob(
		event: ParsedWebhookEvent,
		payload: unknown,
		_project: RouterProjectConfig,
		result: TriggerResult,
		ackResult?: AckResult,
	): CascadeJob {
		const job: GitLabJob = {
			type: 'gitlab',
			source: 'gitlab',
			payload,
			eventType: event.eventType,
			projectPath: (event as GitLabParsedEvent).projectPath,
			receivedAt: new Date().toISOString(),
			triggerResult: result,
			ackCommentId: ackResult?.commentId as number | undefined,
			ackMessage: ackResult?.message,
		};
		return job;
	}

	firePreActions(_job: CascadeJob, _payload: unknown): void {
		// No pre-actions for GitLab currently
	}
}

/**
 * Inject the event type into the payload object for the adapter's parseWebhook.
 * GitLab event type comes from the X-Gitlab-Event header, not the body.
 */
export function injectGitLabEventType(
	payload: unknown,
	eventType: string,
): Record<string, unknown> {
	return {
		...(payload as Record<string, unknown>),
		_eventType: eventType,
	};
}
