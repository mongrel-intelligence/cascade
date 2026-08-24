/**
 * JiraRouterAdapter — platform-specific logic for the router-side
 * JIRA webhook processing pipeline.
 *
 * Extracts the logic previously embedded in `router/jira.ts` into the
 * `RouterPlatformAdapter` interface so it can be driven by the generic
 * `processRouterWebhook()` function.
 */

import { isPmPostingEnabled, resolveUpdateChannel } from '../../config/updateChannel.js';
import {
	type PMRoutingIssueAttributes,
	resolveProjectAmongSiblings,
} from '../../integrations/pm/_shared/project-routing.js';
import { withJiraCredentials } from '../../jira/client.js';
import { captureException } from '../../sentry.js';
import type { TriggerRegistry } from '../../triggers/registry.js';
import type { TriggerContext, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { buildWorkItemRunsLink, getDashboardUrl } from '../../utils/runLink.js';
import { extractJiraContext, generateAckMessage } from '../ackMessageGenerator.js';
import { postJiraAck, resolveJiraBotAccountId } from '../acknowledgments.js';
import { loadProjectConfig, type RouterProjectConfig } from '../config.js';
import type {
	AckResult,
	ParsedWebhookEvent,
	ProjectResolution,
	RouterPlatformAdapter,
} from '../platform-adapter.js';
import { resolveJiraCredentials } from '../platformClients/index.js';
import type { CascadeJob, JiraJob } from '../queue.js';
import { sendAcknowledgeReaction } from '../reactions.js';
import { withPMScopeForDispatch } from './_shared.js';

const PROCESSABLE_EVENTS = [
	'jira:issue_updated',
	'jira:issue_created',
	'comment_created',
	'comment_updated',
];

const NO_ROUTING_ATTRIBUTES: PMRoutingIssueAttributes = { labels: [], components: [] };

/**
 * Ambiguous routing is a configuration error, not an event error: the same
 * misconfiguration re-fires on every webhook for the issue. Report once per
 * issue per process so Sentry shows the problem without drowning in repeats —
 * same rationale as `warnedMissingPricing` in `src/utils/llmMetrics.ts`.
 */
const reportedAmbiguousIssues = new Set<string>();

/**
 * Extended parsed event for JIRA — carries the issue key and webhook event string.
 *
 * `projectId` is absent when routing produced no owner (spec 024): the event is
 * still parsed so the processor can record WHY it was skipped, but no project
 * owns it, so the ack/reaction paths must not fire.
 */
interface JiraParsedEvent extends ParsedWebhookEvent {
	issueKey: string;
	webhookEvent: string;
	projectId?: string;
	routingAttributes?: PMRoutingIssueAttributes;
}

/** Resolution plus whether the key is configured at all — see `resolveForKey`. */
type JiraResolution = ProjectResolution & { hadSiblings: boolean };

function extractRoutingAttributes(
	fields: Record<string, unknown> | undefined,
): PMRoutingIssueAttributes {
	const rawLabels = fields?.labels;
	const rawComponents = fields?.components;
	return {
		labels: Array.isArray(rawLabels)
			? rawLabels.filter((l): l is string => typeof l === 'string')
			: [],
		components: Array.isArray(rawComponents)
			? rawComponents
					.map((c) => (c as Record<string, unknown> | null)?.name)
					.filter((n): n is string => typeof n === 'string')
			: [],
	};
}

export class JiraRouterAdapter implements RouterPlatformAdapter {
	readonly type = 'jira' as const;

	async parseWebhook(payload: unknown): Promise<JiraParsedEvent | null> {
		const p = payload as Record<string, unknown>;
		const webhookEvent = (p.webhookEvent as string) || '';
		const issue = p.issue as Record<string, unknown> | undefined;
		const issueKey = (issue?.key as string) || '';
		const fields = issue?.fields as Record<string, unknown> | undefined;
		const projectField = fields?.project as Record<string, unknown> | undefined;
		const jiraProjectKey = (projectField?.key as string) || '';

		if (!jiraProjectKey) return null;
		if (!PROCESSABLE_EVENTS.some((e) => webhookEvent.startsWith(e))) return null;

		const routingAttributes = extractRoutingAttributes(fields);
		const resolved = await this.resolveForKey(jiraProjectKey, routingAttributes, issueKey);

		// An unconfigured key is not our event at all — drop it at parse time,
		// exactly as before. A key we DO serve that simply matched no sibling is
		// different: keep parsing so the processor can record why it was skipped.
		if (!resolved.hadSiblings) return null;

		const isCommentEvent = webhookEvent.startsWith('comment_');

		return {
			projectIdentifier: jiraProjectKey,
			eventType: webhookEvent,
			workItemId: issueKey || undefined,
			isCommentEvent,
			issueKey,
			webhookEvent,
			routingAttributes,
			...(resolved.project ? { projectId: resolved.project.id } : {}),
		};
	}

	/**
	 * The single place a JIRA project key plus issue attributes become a project.
	 * Both `parseWebhook` and `resolveProjectWithReason` route through it so the
	 * two sites cannot drift — the drift that let a shared key silently shadow a
	 * sibling in the first place.
	 */
	private async resolveForKey(
		projectKey: string,
		attributes: PMRoutingIssueAttributes,
		issueKey: string,
	): Promise<JiraResolution> {
		const config = await loadProjectConfig();
		const siblings = config.projects.filter((p) => p.jira?.projectKey === projectKey);
		if (siblings.length === 0) {
			return {
				project: null,
				reason: `No project config for identifier ${projectKey || '(unknown)'}`,
				hadSiblings: false,
			};
		}

		const outcome = resolveProjectAmongSiblings(
			siblings.map((p) => ({
				projectId: p.id,
				discriminator: p.jira?.routing?.discriminator ?? null,
			})),
			attributes,
		);

		if (outcome.action === 'route') {
			const project = siblings.find((p) => p.id === outcome.projectId);
			if (project) return { project, hadSiblings: true };
		}

		if (outcome.action === 'skip' && outcome.reason === 'ambiguous') {
			if (!reportedAmbiguousIssues.has(issueKey)) {
				reportedAmbiguousIssues.add(issueKey);
				captureException(new Error(`Ambiguous JIRA routing for ${issueKey || projectKey}`), {
					tags: { source: 'pm_routing_ambiguous' },
					extra: {
						issueKey,
						projectKey,
						candidateProjectIds: outcome.candidateProjectIds,
					},
				});
			}
		}

		logger.info('JIRA event matched no owning project', {
			projectKey,
			issueKey,
			reason: outcome.action === 'skip' ? outcome.message : 'resolved project missing from config',
		});
		return {
			project: null,
			reason: outcome.action === 'skip' ? outcome.message : `No project config for ${projectKey}`,
			hadSiblings: true,
		};
	}

	isProcessableEvent(event: ParsedWebhookEvent): boolean {
		return PROCESSABLE_EVENTS.some((e) => event.eventType.startsWith(e));
	}

	async isSelfAuthored(event: ParsedWebhookEvent, payload: unknown): Promise<boolean> {
		if (!event.isCommentEvent) return false;
		const p = payload as Record<string, unknown>;
		const comment = p.comment as Record<string, unknown> | undefined;
		const author = comment?.author as Record<string, unknown> | undefined;
		const commentAuthorId = author?.accountId as string | undefined;
		if (!commentAuthorId) return false;
		try {
			// Absent when routing found no owner — nothing to check against.
			const projectId = (event as JiraParsedEvent).projectId;
			if (!projectId) return false;
			const botId = await resolveJiraBotAccountId(projectId);
			return !!botId && commentAuthorId === botId;
		} catch {
			return false;
		}
	}

	sendReaction(event: ParsedWebhookEvent, payload: unknown): void {
		if (!event.isCommentEvent) return;
		const projectId = (event as JiraParsedEvent).projectId;
		// No owning project ⇒ no credentials to react with, and acknowledging an
		// event we are about to skip would be a lie to the operator.
		if (!projectId) return;
		void sendAcknowledgeReaction('jira', projectId, payload).catch((err) =>
			logger.error('JIRA reaction error', { error: String(err) }),
		);
	}

	async resolveProjectWithReason(event: ParsedWebhookEvent): Promise<ProjectResolution> {
		const jiraEvent = event as JiraParsedEvent;
		const { project, reason } = await this.resolveForKey(
			event.projectIdentifier ?? '',
			jiraEvent.routingAttributes ?? NO_ROUTING_ATTRIBUTES,
			jiraEvent.issueKey ?? event.workItemId ?? '',
		);
		return project ? { project } : { project: null, reason: reason ?? '' };
	}

	async resolveProject(event: ParsedWebhookEvent): Promise<RouterProjectConfig | null> {
		return (await this.resolveProjectWithReason(event)).project;
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
			logger.info('No full project config for JIRA webhook, skipping', {
				projectId: project.id,
			});
			return null;
		}

		const jiraCreds = await resolveJiraCredentials(project.id);
		if (!jiraCreds) {
			logger.warn('Missing JIRA credentials, cannot dispatch triggers', {
				projectId: project.id,
			});
			return null;
		}

		const ctx: TriggerContext = { project: fullProject, source: 'jira', payload };
		return withJiraCredentials(
			{ email: jiraCreds.email, apiToken: jiraCreds.apiToken, baseUrl: jiraCreds.baseUrl },
			() => withPMScopeForDispatch(fullProject, () => triggerRegistry.dispatch(ctx)),
		);
	}

	async postAck(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		agentType: string,
		_triggerResult?: TriggerResult,
	): Promise<AckResult | undefined> {
		const issueKey = (event as JiraParsedEvent).issueKey;
		if (!issueKey) return undefined;
		try {
			const config = await loadProjectConfig();
			const fullProject = config.fullProjects.find((fp) => fp.id === project.id);

			// Skip the PM ack when the agent's update channel disables PM posting.
			// The ack comment is communication-only; status moves / labels are
			// unaffected. Absent full project ⇒ default channel (post everywhere).
			if (fullProject && !isPmPostingEnabled(resolveUpdateChannel(fullProject, agentType))) {
				logger.info('JIRA ack skipped: PM posting disabled for update channel', {
					projectId: project.id,
					agentType,
					issueKey,
				});
				return undefined;
			}

			const context = extractJiraContext(payload);
			let message = await generateAckMessage(agentType, context, project.id);

			// Append run link footer when enabled for this project
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

			const commentId = await postJiraAck(project.id, issueKey, message);
			if (commentId) return { commentId, message };
			return undefined;
		} catch (err) {
			logger.warn('JIRA ack comment failed (non-fatal)', {
				error: String(err),
				issueKey,
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
		const jiraEvent = event as JiraParsedEvent;
		const job: JiraJob = {
			type: 'jira',
			source: 'jira',
			payload,
			projectId: project.id,
			issueKey: jiraEvent.issueKey,
			webhookEvent: jiraEvent.webhookEvent,
			receivedAt: new Date().toISOString(),
			triggerResult: result,
			ackCommentId: ackResult?.commentId as string | undefined,
		};
		return job;
	}
}
