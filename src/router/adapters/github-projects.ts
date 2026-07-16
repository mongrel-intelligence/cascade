/**
 * GitHubProjectsRouterAdapter — platform-specific logic for the router-side
 * GitHub Projects webhook processing pipeline.
 */

import { isPmPostingEnabled, resolveUpdateChannel } from '../../config/updateChannel.js';
import { getViewer, withGitHubProjectsCredentials } from '../../github-projects/client.js';
import type { TriggerRegistry } from '../../triggers/registry.js';
import type { TriggerContext, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { buildWorkItemRunsLink, getDashboardUrl } from '../../utils/runLink.js';
import { extractGitHubProjectsContext, generateAckMessage } from '../ackMessageGenerator.js';
import { loadProjectConfig, type RouterProjectConfig } from '../config.js';
import type { AckResult, ParsedWebhookEvent, RouterPlatformAdapter } from '../platform-adapter.js';
import { resolveGitHubProjectsCredentials } from '../platformClients/index.js';
import type { CascadeJob, GitHubProjectsJob } from '../queue.js';
import { withPMScopeForDispatch } from './_shared.js';

// ============================================================================
// Webhook payload types
// ============================================================================

interface GitHubProjectsWebhookPayload {
	action: string;
	projects_v2_item: {
		id: number;
		node_id: string;
		project_node_id: string;
		content_node_id: string;
		content_type: 'Issue' | 'PullRequest';
	};
	changes?: {
		field_value?: {
			field_node_id: string;
			field_type?: string;
			// GitHub does not reliably send field_name / from / to on
			// projects_v2_item.edited — treat them as optional hints.
			field_name?: string;
			from?: { id: string; name: string } | null;
			to?: { id: string; name: string } | null;
		};
	};
	sender?: {
		login: string;
	};
}

interface GitHubProjectsParsedEvent extends ParsedWebhookEvent {
	projectId: string;
	action: string;
	contentType: 'issue' | 'pull_request';
	statusChange?: {
		from: string | null;
		to: string | null;
		fieldId: string;
		fieldName?: string;
	};
}

// ============================================================================
// Adapter
// ============================================================================

export class GitHubProjectsRouterAdapter implements RouterPlatformAdapter {
	readonly type = 'github-projects' as const;

	/**
	 * Resolve credentials for a project.
	 * Logs a warning and returns null if credentials are missing.
	 */
	private async resolveCredentials(
		projectId: string,
		context: string,
	): Promise<{ token: string } | null> {
		const creds = await resolveGitHubProjectsCredentials(projectId);
		if (!creds) {
			logger.warn(`GitHubProjectsRouterAdapter: missing credentials for ${context}`, { projectId });
			return null;
		}
		return creds;
	}

	/**
	 * Resolve the current authenticated viewer for a project.
	 * Returns null if credentials are missing or the API call fails.
	 */
	private async resolveViewer(projectId: string): Promise<{ login: string } | null> {
		try {
			const creds = await this.resolveCredentials(projectId, 'viewer resolution');
			if (!creds) return null;
			return await withGitHubProjectsCredentials({ token: creds.token }, () => getViewer());
		} catch {
			return null;
		}
	}

	async parseWebhook(payload: unknown): Promise<GitHubProjectsParsedEvent | null> {
		const p = payload as GitHubProjectsWebhookPayload;

		if (!p.action || !p.projects_v2_item) {
			logger.debug('GitHubProjectsRouterAdapter: missing required fields', { payload });
			return null;
		}

		const item = p.projects_v2_item;
		if (!item.project_node_id || !item.content_node_id) {
			logger.debug('GitHubProjectsRouterAdapter: missing project or content node id', { payload });
			return null;
		}

		const changes = p.changes?.field_value;

		// Only process field-value edits. Creation events do not carry a status
		// change in the same payload, so they are not processable here.
		//
		// GitHub's `projects_v2_item.edited` webhook does not reliably include the
		// changed field's name, so we cannot require `field_name === 'Status'` at
		// parse time. We forward any field-value edit and let the trigger confirm
		// the Status field authoritatively (via a live GraphQL read). When the
		// field name IS present and is not Status, skip early as an optimization.
		if (p.action !== 'edited' || !changes) {
			logger.debug('GitHubProjectsRouterAdapter: ignoring non-processable action/field', {
				action: p.action,
				hasFieldChange: !!changes,
			});
			return null;
		}
		if (changes.field_name && changes.field_name !== 'Status') {
			logger.debug('GitHubProjectsRouterAdapter: ignoring non-Status field edit', {
				fieldName: changes.field_name,
			});
			return null;
		}

		return {
			projectIdentifier: item.project_node_id,
			eventType: `projects_v2_item/${p.action}`,
			workItemId: item.content_node_id,
			isCommentEvent: false,
			actionId: item.node_id,
			projectId: item.project_node_id,
			action: p.action,
			contentType: item.content_type === 'PullRequest' ? 'pull_request' : 'issue',
			statusChange: changes
				? {
						from: changes.from?.name ?? null,
						to: changes.to?.name ?? null,
						fieldId: changes.field_node_id,
						fieldName: changes.field_name,
					}
				: undefined,
		};
	}

	isProcessableEvent(event: ParsedWebhookEvent): boolean {
		const e = event as GitHubProjectsParsedEvent;
		return e.eventType.startsWith('projects_v2_item/');
	}

	async isSelfAuthored(event: ParsedWebhookEvent, payload: unknown): Promise<boolean> {
		const e = event as GitHubProjectsParsedEvent;
		if (!e.projectId) return false;

		const sender = (payload as GitHubProjectsWebhookPayload).sender;
		const senderLogin = sender?.login;
		if (!senderLogin) return false;

		// Credential/viewer resolution keys on the CASCADE project id, not the
		// GitHub Projects node id carried on the event (`PVT_…`). Resolve the
		// project by its GitHub node id first and pass the CASCADE id through,
		// mirroring dispatchWithCredentials / postAck. Passing the node id here
		// makes resolveViewer always return null, silently disabling
		// loop-prevention.
		const project = await this.resolveProject(event);
		if (!project) return false;

		const me = await this.resolveViewer(project.id);
		return me?.login === senderLogin;
	}

	sendReaction(_event: ParsedWebhookEvent, _payload: unknown): void {
		// No reaction support for GitHub Projects item webhooks.
	}

	async resolveProject(event: ParsedWebhookEvent): Promise<RouterProjectConfig | null> {
		const config = await loadProjectConfig();
		return (
			config.projects.find((p) => p.githubProjects?.projectId === event.projectIdentifier) ?? null
		);
	}

	async dispatchWithCredentials(
		_event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		triggerRegistry: TriggerRegistry,
	): Promise<TriggerResult | null> {
		const config = await loadProjectConfig();
		const fullProject = config.fullProjects.find((fp) => fp.id === project.id);
		if (!fullProject) {
			logger.info('GitHubProjectsRouterAdapter: no full project config found', {
				projectId: project.id,
			});
			return null;
		}

		const creds = await this.resolveCredentials(project.id, 'trigger dispatch');
		if (!creds) return null;

		const ctx: TriggerContext = { project: fullProject, source: 'github-projects', payload };
		return withGitHubProjectsCredentials({ token: creds.token }, () =>
			withPMScopeForDispatch(fullProject, () => triggerRegistry.dispatch(ctx)),
		);
	}

	async postAck(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		agentType: string,
		_triggerResult?: TriggerResult,
	): Promise<AckResult | undefined> {
		const issueId = event.workItemId;
		if (!issueId) return undefined;

		try {
			const config = await loadProjectConfig();
			const fullProject = config.fullProjects.find((fp) => fp.id === project.id);

			if (fullProject && !isPmPostingEnabled(resolveUpdateChannel(fullProject, agentType))) {
				logger.info('GitHubProjectsRouterAdapter: ack skipped, PM posting disabled for channel', {
					projectId: project.id,
					agentType,
					issueId,
				});
				return undefined;
			}

			const context = extractGitHubProjectsContext(payload);
			let message = await generateAckMessage(agentType, context, project.id);

			if (fullProject?.runLinksEnabled && event.workItemId) {
				const dashboardUrl = getDashboardUrl();
				if (dashboardUrl) {
					const link = buildWorkItemRunsLink({
						dashboardUrl,
						projectId: project.id,
						workItemId: event.workItemId,
					});
					if (link) message += link;
				}
			}

			const creds = await this.resolveCredentials(project.id, 'ack comment');
			if (!creds) return undefined;

			const { addCommentToIssue, withGitHubProjectsCredentials } = await import(
				'../../github-projects/client.js'
			);
			const commentId = await withGitHubProjectsCredentials({ token: creds.token }, () =>
				addCommentToIssue(issueId, message),
			);
			return { commentId, message };
		} catch (err) {
			logger.warn('GitHubProjectsRouterAdapter: ack comment failed (non-fatal)', {
				error: String(err),
				issueId,
			});
			return undefined;
		}
	}

	buildJob(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		result: TriggerResult,
		ackResult?: AckResult,
	): CascadeJob {
		const e = event as GitHubProjectsParsedEvent;
		const job: GitHubProjectsJob = {
			type: 'github-projects',
			source: 'github-projects',
			payload,
			projectId: project.id,
			workItemId: e.workItemId,
			eventType: e.eventType,
			receivedAt: new Date().toISOString(),
			triggerResult: result,
			ackCommentId: ackResult?.commentId as string | undefined,
		};
		return job;
	}
}
