/**
 * GitHubRouterAdapter — platform-specific logic for the router-side
 * GitHub webhook processing pipeline.
 *
 * Extracts the logic previously embedded in `router/github.ts` into the
 * `RouterPlatformAdapter` interface so it can be driven by the generic
 * `processRouterWebhook()` function.
 */

import { isPMFocusedAgent } from '../../agents/definitions/loader.js';
import { getProjectGitHubToken } from '../../config/projects.js';
import { findProjectByRepo } from '../../config/provider.js';
import { withGitHubToken } from '../../github/client.js';
import {
	type PersonaIdentities,
	isCascadeBot,
	resolvePersonaIdentities,
} from '../../github/personas.js';
import { withPMCredentials, withPMProvider } from '../../pm/context.js';
import { pmRegistry } from '../../pm/registry.js';
import { captureException } from '../../sentry.js';
import type { TriggerRegistry } from '../../triggers/registry.js';
import type { TriggerContext, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { buildWorkItemRunsLink, getDashboardUrl } from '../../utils/runLink.js';
import { extractGitHubContext, generateAckMessage } from '../ackMessageGenerator.js';
import {
	postGitHubAck,
	postJiraAck,
	postTrelloAck,
	resolveGitHubTokenForAckByAgent,
} from '../acknowledgments.js';
import { type RouterProjectConfig, loadProjectConfig } from '../config.js';
import { extractPRNumber } from '../notifications.js';
import type { AckResult, ParsedWebhookEvent, RouterPlatformAdapter } from '../platform-adapter.js';
import { addEyesReactionToPR } from '../pre-actions.js';
import type { CascadeJob, GitHubJob } from '../queue.js';
import { sendAcknowledgeReaction } from '../reactions.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Post an acknowledgment comment to the PM tool (Trello/JIRA) for PM-focused agents.
 * Returns an AckResult with the comment ID and message, or undefined on failure.
 */
async function postPMAck(
	projectId: string,
	workItemId: string,
	pmType: string | undefined,
	agentType: string,
	message: string,
): Promise<AckResult | undefined> {
	let commentId: string | null = null;
	if (pmType === 'trello') {
		commentId = await postTrelloAck(projectId, workItemId, message);
	} else if (pmType === 'jira') {
		commentId = await postJiraAck(projectId, workItemId, message);
	} else {
		logger.warn('Unknown PM type for PM-focused agent ack, skipping', { agentType, pmType });
		return undefined;
	}
	if (commentId) return { commentId, message };
	return undefined;
}

/**
 * Post a GitHub PR acknowledgment comment using the agent-specific token.
 * Returns an AckResult, or undefined if not applicable.
 */
async function postGitHubPRAck(
	repoFullName: string,
	eventType: string,
	payload: unknown,
	agentType: string,
	projectId: string,
): Promise<AckResult | undefined> {
	const resolved = await resolveGitHubTokenForAckByAgent(repoFullName, agentType);
	if (!resolved) return undefined;

	const context = extractGitHubContext(payload, eventType);
	const message = await generateAckMessage(agentType, context, projectId);
	const tempJob = { eventType, repoFullName, payload } as GitHubJob;
	const prNumber = extractPRNumber(tempJob);
	if (!prNumber) return undefined;

	const commentId = await postGitHubAck(repoFullName, prNumber, message, resolved.token);
	if (commentId != null) return { commentId, message };
	return undefined;
}

const PROCESSABLE_EVENTS = [
	'pull_request',
	'pull_request_review',
	'pull_request_review_comment',
	'issue_comment',
	'check_suite',
];

/**
 * Extended parsed event for GitHub — carries the repo name and resolved personas.
 */
interface GitHubParsedEvent extends ParsedWebhookEvent {
	repoFullName: string;
	personaIdentities?: PersonaIdentities;
}

function getGitHubDeliveryId(payload: Record<string, unknown>): string | undefined {
	const deliveryId = payload._deliveryId;
	return typeof deliveryId === 'string' && deliveryId.length > 0 ? deliveryId : undefined;
}

export class GitHubRouterAdapter implements RouterPlatformAdapter {
	readonly type = 'github' as const;

	async parseWebhook(payload: unknown): Promise<GitHubParsedEvent | null> {
		const p = payload as Record<string, unknown>;
		const repo = p.repository as Record<string, unknown> | undefined;
		const repoFullName = (repo?.full_name as string) || 'unknown';
		const eventType = (p._eventType as string) || 'unknown';

		if (!PROCESSABLE_EVENTS.includes(eventType)) return null;

		const isCommentEvent =
			eventType === 'issue_comment' || eventType === 'pull_request_review_comment';

		// Extract work item ID (PR number as string, if available)
		let workItemId: string | undefined;
		const pr = p.pull_request as Record<string, unknown> | undefined;
		if (pr?.number) {
			workItemId = String(pr.number);
		} else if (isCommentEvent) {
			const issue = p.issue as Record<string, unknown> | undefined;
			if (issue?.number) workItemId = String(issue.number);
		}

		return {
			projectIdentifier: repoFullName,
			eventType,
			workItemId,
			isCommentEvent,
			actionId: getGitHubDeliveryId(p),
			repoFullName,
		};
	}

	isProcessableEvent(event: ParsedWebhookEvent): boolean {
		return PROCESSABLE_EVENTS.includes(event.eventType);
	}

	async isSelfAuthored(event: ParsedWebhookEvent, payload: unknown): Promise<boolean> {
		if (!event.isCommentEvent) return false;
		const p = payload as Record<string, unknown>;
		const commentUser = (p.comment as Record<string, unknown> | undefined)?.user as
			| Record<string, unknown>
			| undefined;
		const login = commentUser?.login as string | undefined;
		if (!login) return false;
		try {
			const project = await findProjectByRepo((event as GitHubParsedEvent).repoFullName);
			if (!project) return false;
			const personas = await resolvePersonaIdentities(project.id);
			return isCascadeBot(login, personas);
		} catch {
			return false;
		}
	}

	sendReaction(event: ParsedWebhookEvent, payload: unknown): void {
		if (!event.isCommentEvent) return;
		const repoFullName = (event as GitHubParsedEvent).repoFullName;
		void (async () => {
			try {
				const project = await findProjectByRepo(repoFullName);
				if (!project) {
					logger.warn('No project found for repo, skipping GitHub reaction', { repoFullName });
					return;
				}
				const personaIdentities = await resolvePersonaIdentities(project.id);
				await sendAcknowledgeReaction('github', repoFullName, payload, personaIdentities, project);
			} catch (err) {
				logger.warn('GitHub reaction error', { error: String(err), repoFullName });
				captureException(err, {
					tags: { source: 'github_ack_reaction' },
					extra: { repoFullName },
				});
			}
		})();
	}

	async resolveProject(event: ParsedWebhookEvent): Promise<RouterProjectConfig | null> {
		const repoFullName = (event as GitHubParsedEvent).repoFullName;
		const config = await loadProjectConfig();
		return config.projects.find((p) => p.repo === repoFullName) ?? null;
	}

	async dispatchWithCredentials(
		event: ParsedWebhookEvent,
		payload: unknown,
		_project: RouterProjectConfig,
		triggerRegistry: TriggerRegistry,
	): Promise<TriggerResult | null> {
		const config = await loadProjectConfig();
		const fullProject = config.fullProjects.find(
			(fp) => fp.repo === (event as GitHubParsedEvent).repoFullName,
		);
		if (!fullProject) {
			logger.info('No project for GitHub repo, skipping dispatch', {
				repoFullName: (event as GitHubParsedEvent).repoFullName,
			});
			return null;
		}

		let personaIdentities: PersonaIdentities | undefined;
		try {
			personaIdentities = await resolvePersonaIdentities(fullProject.id);
		} catch {
			// Persona resolution may fail — proceed without
		}

		const githubToken = await getProjectGitHubToken(fullProject);
		const pmProvider = pmRegistry.createProvider(fullProject);

		const ctx: TriggerContext = {
			project: fullProject,
			source: 'github',
			payload,
			personaIdentities,
		};

		return withPMCredentials(
			fullProject.id,
			fullProject.pm?.type,
			(t) => pmRegistry.getOrNull(t),
			() =>
				withPMProvider(pmProvider, () =>
					withGitHubToken(githubToken, () => triggerRegistry.dispatch(ctx)),
				),
		);
	}

	async postAck(
		event: ParsedWebhookEvent,
		payload: unknown,
		project: RouterProjectConfig,
		agentType: string,
		triggerResult?: TriggerResult,
	): Promise<AckResult | undefined> {
		try {
			// Load full project config to check run link settings
			const config = await loadProjectConfig();
			const fullProject = config.fullProjects.find((fp) => fp.id === project.id);
			const runLinksEnabled = fullProject?.runLinksEnabled ?? false;

			// Helper to append run link footer to a message when enabled
			const withRunLink = (message: string, workItemId?: string): string => {
				if (!runLinksEnabled || !workItemId) return message;
				const dashboardUrl = getDashboardUrl();
				if (!dashboardUrl) return message;
				const link = buildWorkItemRunsLink({ dashboardUrl, projectId: project.id, workItemId });
				return link ? message + link : message;
			};

			// PM-focused agents (e.g. backlog-manager) should have ack posted to the PM tool
			// (Trello/JIRA card), not to the already-merged GitHub PR.
			if (await isPMFocusedAgent(agentType)) {
				const workItemId = triggerResult?.workItemId ?? event.workItemId;
				if (!workItemId) {
					logger.warn('PM-focused agent has no workItemId for ack, skipping PM ack', { agentType });
					return undefined;
				}
				const context = extractGitHubContext(payload, event.eventType);
				const baseMessage = await generateAckMessage(agentType, context, project.id);
				const message = withRunLink(baseMessage, workItemId);
				return postPMAck(project.id, workItemId, project.pmType, agentType, message);
			}

			const ackResult = await postGitHubPRAck(
				(event as GitHubParsedEvent).repoFullName,
				event.eventType,
				payload,
				agentType,
				project.id,
			);

			// For GitHub PR acks, append run link to the message if enabled
			// (Note: the comment is already posted, we just update the returned message for reference)
			if (ackResult && runLinksEnabled && event.workItemId) {
				const dashboardUrl = getDashboardUrl();
				if (dashboardUrl) {
					const link = buildWorkItemRunsLink({
						dashboardUrl,
						projectId: project.id,
						workItemId: event.workItemId,
					});
					if (link) {
						return { ...ackResult, message: (ackResult.message ?? '') + link };
					}
				}
			}

			return ackResult;
		} catch (err) {
			logger.warn('GitHub ack comment failed (non-fatal)', { error: String(err) });
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
		const job: GitHubJob = {
			type: 'github',
			source: 'github',
			payload,
			eventType: event.eventType,
			repoFullName: (event as GitHubParsedEvent).repoFullName,
			receivedAt: new Date().toISOString(),
			triggerResult: result,
			ackCommentId: ackResult?.commentId as number | undefined,
			ackMessage: ackResult?.message,
		};
		return job;
	}

	firePreActions(job: CascadeJob, payload: unknown): void {
		const ghJob = job as GitHubJob;
		if (ghJob.eventType !== 'check_suite') return;
		const p = payload as Record<string, unknown>;
		const suite = p.check_suite as Record<string, unknown> | undefined;
		const action = p.action as string | undefined;
		const conclusion = suite?.conclusion as string | undefined;
		const prs = suite?.pull_requests as Array<unknown> | undefined;
		if (action === 'completed' && conclusion === 'success' && prs && prs.length > 0) {
			addEyesReactionToPR(ghJob).catch((err) =>
				logger.warn('Pre-action error (eyes reaction)', { error: String(err) }),
			);
		}
	}
}

/**
 * Inject the event type into the payload object for the adapter's parseWebhook.
 * GitHub event type comes from the X-GitHub-Event header, not the body.
 */
export function injectEventType(
	payload: unknown,
	eventType: string,
	deliveryId?: string,
): Record<string, unknown> {
	return {
		...(payload as Record<string, unknown>),
		_eventType: eventType,
		...(deliveryId ? { _deliveryId: deliveryId } : {}),
	};
}
