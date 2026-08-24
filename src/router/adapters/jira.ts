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

/**
 * Stand-in for an event that carries no routing attributes.
 *
 * NOT a neutral value: an attribute-less issue matches no discriminator, so it
 * resolves to the key's default. That is correct for an issue genuinely without
 * labels or components, and it is what every event from `parseWebhook` means —
 * that method always populates the field. It would be a fabricated decision for
 * an event constructed elsewhere, which is why `parseWebhook` sets it
 * unconditionally rather than leaving it optional in practice.
 */
const NO_ROUTING_ATTRIBUTES: PMRoutingIssueAttributes = { labels: [], components: [] };

/**
 * Ambiguous routing is a configuration error, not an event error: the same
 * misconfiguration re-fires on every webhook for the issue. Report once per
 * issue per process so Sentry shows the problem without drowning in repeats.
 *
 * Unlike the ephemeral-worker dedup sets elsewhere in the codebase, the router
 * is long-lived and the key domain is unbounded (JIRA issue keys), so this
 * never resets in practice. That is deliberate — the spec asks only that the
 * first occurrence be reported — and the growth is bounded by distinct
 * ambiguously-labelled issues on shared keys, which is small.
 */
const reportedAmbiguousIssues = new Set<string>();

/**
 * Shared keys where nobody has opted into routing — reported once per KEY, not
 * per issue, because a shadowed sibling is a configuration problem that every
 * event on that key would otherwise re-report.
 */
const reportedUnconfiguredKeys = new Set<string>();

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

		// Sharing is OPT-IN. A key whose projects have all declared nothing is a
		// pre-024 deployment — the discriminator field did not exist, so this is
		// the only duplicate state it could be in. Strict matching would take it
		// from "one project works, the other is shadowed" to "nothing works",
		// with no wizard field to fix it until plan 5. Keep first-match, but stop
		// being silent about the sibling that is being shadowed.
		if (siblings.length > 1 && !siblings.some((p) => p.jira?.routing?.discriminator)) {
			if (!reportedUnconfiguredKeys.has(projectKey)) {
				reportedUnconfiguredKeys.add(projectKey);
				const shadowed = siblings.slice(1).map((p) => p.id);
				logger.warn(
					`JIRA key ${projectKey} is claimed by several projects but none declares a routing discriminator; ` +
						`events go to "${siblings[0].id}" and ${shadowed.join(', ')} receive nothing. ` +
						`Add a routing discriminator to route them separately.`,
					{ projectKey, routedTo: siblings[0].id, shadowed },
				);
				captureException(new Error(`Unconfigured shared JIRA key ${projectKey}`), {
					tags: { source: 'pm_shared_key_unconfigured' },
					extra: { projectKey, routedTo: siblings[0].id, shadowed },
				});
			}
			return { project: siblings[0], hadSiblings: true };
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
			// The resolver only ever returns an id from the list above, so this is
			// a broken contract rather than a routing outcome. Say so instead of
			// degrading into a skip whose reason would be nonsense.
			captureException(new Error(`JIRA resolver returned unknown project "${outcome.projectId}"`), {
				tags: { source: 'pm_routing_resolver_contract' },
				extra: { projectKey, candidates: siblings.map((p) => p.id) },
			});
			return {
				project: null,
				reason: `Internal routing error for JIRA key ${projectKey}`,
				hadSiblings: true,
			};
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

		// The resolver is provider-agnostic and never sees the key, so it can only
		// say "this board key". Name it here — the decision reason is the
		// operator's whole diagnosis, and it has to identify what was being routed.
		// No log line: `resolveForKey` runs twice per webhook (parse, then
		// resolve), and the processor already logs this reason exactly once.
		return {
			project: null,
			reason: `JIRA key ${projectKey}: ${outcome.message}`,
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

	/**
	 * Legacy single-result resolution.
	 *
	 * Kept because `RouterPlatformAdapter` declares it and callers outside the
	 * processor use it. Note it discards the reason — anything that needs to
	 * explain a miss must call `resolveProjectWithReason`.
	 */

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
