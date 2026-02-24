/**
 * GitHubRouterAdapter — platform-specific logic for the router-side
 * GitHub webhook processing pipeline.
 *
 * Extracts the logic previously embedded in `router/github.ts` into the
 * `RouterPlatformAdapter` interface so it can be driven by the generic
 * `processRouterWebhook()` function.
 */

import { getProjectGitHubToken } from '../../config/projects.js';
import { findProjectByRepo } from '../../config/provider.js';
import { withGitHubToken } from '../../github/client.js';
import {
	type PersonaIdentities,
	isCascadeBot,
	resolvePersonaIdentities,
} from '../../github/personas.js';
import { withPMCredentials, withPMProvider } from '../../pm/context.js';
import { JiraIntegration } from '../../pm/jira/integration.js';
import { pmRegistry } from '../../pm/registry.js';
import { TrelloIntegration } from '../../pm/trello/integration.js';
import { captureException } from '../../sentry.js';
import type { TriggerRegistry } from '../../triggers/registry.js';
import type { TriggerContext, TriggerResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { extractGitHubContext, generateAckMessage } from '../ackMessageGenerator.js';
import { postGitHubAck, resolveGitHubTokenForAck } from '../acknowledgments.js';
import { type RouterProjectConfig, loadProjectConfig } from '../config.js';
import { extractPRNumber } from '../notifications.js';
import type { ParsedWebhookEvent, RouterPlatformAdapter } from '../platform-adapter.js';
import { addEyesReactionToPR } from '../pre-actions.js';
import { type CascadeJob, type GitHubJob, addJob } from '../queue.js';
import { sendAcknowledgeReaction } from '../reactions.js';

// Ensure PM integrations are registered (idempotent)
if (!pmRegistry.getOrNull('trello')) pmRegistry.register(new TrelloIntegration());
if (!pmRegistry.getOrNull('jira')) pmRegistry.register(new JiraIntegration());

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
	): Promise<number | undefined> {
		try {
			const context = extractGitHubContext(payload, event.eventType);
			const message = await generateAckMessage(agentType, context, project.id);
			const resolved = await resolveGitHubTokenForAck((event as GitHubParsedEvent).repoFullName);
			if (resolved) {
				const tempJob = {
					eventType: event.eventType,
					repoFullName: (event as GitHubParsedEvent).repoFullName,
					payload,
				} as GitHubJob;
				const prNumber = extractPRNumber(tempJob);
				if (prNumber) {
					const commentId = await postGitHubAck(
						(event as GitHubParsedEvent).repoFullName,
						prNumber,
						message,
						resolved.token,
					);
					if (commentId != null) return commentId;
				}
			}
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
		ackCommentId: string | number | undefined,
		ackMessage?: string,
	): CascadeJob {
		const job: GitHubJob = {
			type: 'github',
			source: 'github',
			payload,
			eventType: event.eventType,
			repoFullName: (event as GitHubParsedEvent).repoFullName,
			receivedAt: new Date().toISOString(),
			ackCommentId: ackCommentId as number | undefined,
			ackMessage,
			triggerResult: result,
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
export function injectEventType(payload: unknown, eventType: string): Record<string, unknown> {
	return { ...(payload as Record<string, unknown>), _eventType: eventType };
}

async function postGitHubAckComment(
	agentType: string,
	payload: unknown,
	eventType: string,
	repoFullName: string,
	projectId: string,
): Promise<{ ackCommentId?: number; ackMessage?: string }> {
	try {
		const context = extractGitHubContext(payload, eventType);
		const message = await generateAckMessage(agentType, context, projectId);
		const resolved = await resolveGitHubTokenForAck(repoFullName);
		if (!resolved) return {};
		const tempJob = { eventType, repoFullName, payload } as GitHubJob;
		const prNumber = extractPRNumber(tempJob);
		if (!prNumber) return {};
		const commentId = await postGitHubAck(repoFullName, prNumber, message, resolved.token);
		if (commentId != null) return { ackCommentId: commentId, ackMessage: message };
	} catch (err) {
		logger.warn('GitHub ack comment failed (non-fatal)', { error: String(err) });
	}
	return {};
}

/**
 * Legacy entry-point wrapper kept for backward compatibility.
 * New code should use `processRouterWebhook()` with the adapter.
 */
export async function handleGitHubWebhookViaAdapter(
	eventType: string,
	payload: unknown,
	triggerRegistry: TriggerRegistry,
): Promise<{ shouldProcess: boolean; repoFullName: string }> {
	const p = payload as Record<string, unknown>;
	const repo = p.repository as Record<string, unknown> | undefined;
	const repoFullName = (repo?.full_name as string) || 'unknown';

	if (!PROCESSABLE_EVENTS.includes(eventType)) {
		logger.debug('Ignoring GitHub event', { eventType });
		return { shouldProcess: false, repoFullName };
	}

	const adapter = new GitHubRouterAdapter();
	const augmented = injectEventType(payload, eventType);
	const event = await adapter.parseWebhook(augmented);
	if (!event) return { shouldProcess: false, repoFullName };

	if (await adapter.isSelfAuthored(event, payload)) {
		logger.info('Ignoring self-authored GitHub comment', { repoFullName });
		return { shouldProcess: true, repoFullName };
	}

	adapter.sendReaction(event, payload);

	const config = await loadProjectConfig();
	const fullProject = config.fullProjects.find((fp) => fp.repo === repoFullName);
	if (!fullProject) {
		logger.info('No project for GitHub repo, skipping dispatch', { repoFullName });
		return { shouldProcess: true, repoFullName };
	}

	const project = config.projects.find((proj) => proj.repo === repoFullName);
	if (!project) return { shouldProcess: true, repoFullName };

	let result: TriggerResult | null = null;
	try {
		result = await adapter.dispatchWithCredentials(event, augmented, project, triggerRegistry);
	} catch (err) {
		logger.warn('GitHub trigger dispatch failed (non-fatal)', { error: String(err), repoFullName });
	}

	if (!result) {
		logger.info('No trigger matched for GitHub event', { eventType, repoFullName });
		return { shouldProcess: true, repoFullName };
	}

	logger.info('GitHub trigger matched', {
		agentType: result.agentType || '(no agent)',
		prNumber: result.prNumber,
		repoFullName,
	});

	if (!result.agentType) {
		logger.info('Trigger completed without agent (PM operation done)');
		return { shouldProcess: true, repoFullName };
	}

	const { ackCommentId, ackMessage } = await postGitHubAckComment(
		result.agentType,
		payload,
		eventType,
		repoFullName,
		fullProject.id,
	);

	const job: CascadeJob = {
		type: 'github',
		source: 'github',
		payload,
		eventType,
		repoFullName,
		receivedAt: new Date().toISOString(),
		ackCommentId,
		ackMessage,
		triggerResult: result,
	};

	adapter.firePreActions(job, payload);

	try {
		const jobId = await addJob(job);
		logger.info('GitHub job queued', { jobId, eventType, ackCommentId });
	} catch (err) {
		logger.error('Failed to queue GitHub job', { error: String(err), eventType, repoFullName });
	}

	return { shouldProcess: true, repoFullName };
}
