/**
 * GitHub webhook handler for the router (multi-container) deployment mode.
 *
 * Runs full trigger dispatch() to determine if a job should be queued.
 * Only posts ack comments and queues jobs when dispatch confirms a match.
 */

import { getProjectGitHubToken } from '../config/projects.js';
import { findProjectByRepo } from '../config/provider.js';
import { withGitHubToken } from '../github/client.js';
import {
	type PersonaIdentities,
	isCascadeBot,
	resolvePersonaIdentities,
} from '../github/personas.js';
import { withPMCredentials, withPMProvider } from '../pm/context.js';
import { pmRegistry } from '../pm/registry.js';
import { captureException } from '../sentry.js';
import type { TriggerRegistry } from '../triggers/registry.js';
import type { TriggerContext, TriggerResult } from '../types/index.js';
import { logger } from '../utils/logging.js';
import { extractGitHubContext, generateAckMessage } from './ackMessageGenerator.js';
import { postGitHubAck, resolveGitHubTokenForAck } from './acknowledgments.js';
import { loadProjectConfig } from './config.js';
import { extractPRNumber } from './notifications.js';
import { addEyesReactionToPR } from './pre-actions.js';
import { type CascadeJob, type GitHubJob, addJob } from './queue.js';
import { sendAcknowledgeReaction } from './reactions.js';

// Ensure PM integrations are registered (idempotent — uses the same singleton registry
// that pm/index.ts populates, but we import from sub-modules to avoid pulling in
// the webhook handler's agent-execution transitive deps).
import { JiraIntegration } from '../pm/jira/integration.js';
import { TrelloIntegration } from '../pm/trello/integration.js';
if (!pmRegistry.getOrNull('trello')) pmRegistry.register(new TrelloIntegration());
if (!pmRegistry.getOrNull('jira')) pmRegistry.register(new JiraIntegration());

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export async function isSelfAuthoredGitHubComment(
	payload: unknown,
	repoFullName: string,
): Promise<boolean> {
	const p = payload as Record<string, unknown>;
	const commentUser = (p.comment as Record<string, unknown> | undefined)?.user as
		| Record<string, unknown>
		| undefined;
	const login = commentUser?.login as string | undefined;
	if (!login) return false;
	try {
		const project = await findProjectByRepo(repoFullName);
		if (!project) return false;
		const personas = await resolvePersonaIdentities(project.id);
		return isCascadeBot(login, personas);
	} catch {
		return false; // Persona resolution failed — proceed normally
	}
}

export function fireGitHubAckReaction(repoFullName: string, payload: unknown): void {
	void (async () => {
		try {
			const project = await findProjectByRepo(repoFullName);
			if (!project) {
				logger.warn('No project found for repo, skipping GitHub reaction', {
					repoFullName,
				});
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

/**
 * Fire non-blocking pre-actions for a GitHub job before it is queued.
 * Currently adds a 👀 reaction for first-time check_suite success events.
 */
export function firePreActions(job: GitHubJob, p: Record<string, unknown>): void {
	if (job.eventType !== 'check_suite') return;
	const suite = p.check_suite as Record<string, unknown> | undefined;
	const action = p.action as string | undefined;
	const conclusion = suite?.conclusion as string | undefined;
	const prs = suite?.pull_requests as Array<unknown> | undefined;
	if (action === 'completed' && conclusion === 'success' && prs && prs.length > 0) {
		addEyesReactionToPR(job).catch((err) =>
			logger.warn('Pre-action error (eyes reaction)', { error: String(err) }),
		);
	}
}

async function tryPostAck(
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
		if (resolved) {
			const tempJob = { eventType, repoFullName, payload } as GitHubJob;
			const prNumber = extractPRNumber(tempJob);
			if (prNumber) {
				const commentId = await postGitHubAck(repoFullName, prNumber, message, resolved.token);
				if (commentId != null) {
					return { ackCommentId: commentId, ackMessage: message };
				}
			}
		}
	} catch (err) {
		logger.warn('GitHub ack comment failed (non-fatal)', { error: String(err) });
	}
	return {};
}

export async function processGitHubWebhookEvent(
	eventType: string,
	repoFullName: string,
	payload: unknown,
	triggerRegistry: TriggerRegistry,
): Promise<void> {
	const isCommentEvent =
		eventType === 'issue_comment' || eventType === 'pull_request_review_comment';

	if (isCommentEvent && (await isSelfAuthoredGitHubComment(payload, repoFullName))) {
		logger.info('Ignoring self-authored GitHub comment', { repoFullName });
		return;
	}

	// Fire-and-forget acknowledgment reaction — only for comment events that @mention the bot
	if (isCommentEvent) {
		fireGitHubAckReaction(repoFullName, payload);
	}

	// Resolve project and credentials for authoritative dispatch
	const config = await loadProjectConfig();
	const fullProject = config.fullProjects.find((fp) => fp.repo === repoFullName);
	if (!fullProject) {
		logger.info('No project for GitHub repo, skipping dispatch', { repoFullName });
		return;
	}

	let personaIdentities: PersonaIdentities | undefined;
	try {
		personaIdentities = await resolvePersonaIdentities(fullProject.id);
	} catch {
		// Persona resolution may fail — proceed without
	}

	// Run authoritative trigger dispatch with all credential scopes
	let result: TriggerResult | null = null;
	try {
		const githubToken = await getProjectGitHubToken(fullProject);
		const pmProvider = pmRegistry.createProvider(fullProject);

		const ctx: TriggerContext = {
			project: fullProject,
			source: 'github',
			payload,
			personaIdentities,
		};

		result = await withPMCredentials(
			fullProject.id,
			fullProject.pm?.type,
			(t) => pmRegistry.getOrNull(t),
			() =>
				withPMProvider(pmProvider, () =>
					withGitHubToken(githubToken, () => triggerRegistry.dispatch(ctx)),
				),
		);
	} catch (err) {
		logger.warn('GitHub trigger dispatch failed (non-fatal)', { error: String(err), repoFullName });
	}

	if (!result) {
		logger.info('No trigger matched for GitHub event', { eventType, repoFullName });
		return;
	}

	logger.info('GitHub trigger matched', {
		agentType: result.agentType || '(no agent)',
		prNumber: result.prNumber,
		repoFullName,
	});

	// For triggers with no agent (pr-merged, pr-ready-to-merge), dispatch already
	// performed the PM operations. No job queuing needed.
	if (!result.agentType) {
		logger.info('Trigger completed without agent (PM operation done)');
		return;
	}

	// Post ack comment — we KNOW the trigger matched
	const { ackCommentId, ackMessage } = await tryPostAck(
		result.agentType,
		payload,
		eventType,
		repoFullName,
		fullProject.id,
	);

	// Queue job with confirmed trigger result
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

	// Fire pre-actions (non-blocking) before queueing
	const p = payload as Record<string, unknown>;
	firePreActions(job as GitHubJob, p);

	try {
		const jobId = await addJob(job);
		logger.info('GitHub job queued', { jobId, eventType, ackCommentId });
	} catch (err) {
		logger.error('Failed to queue GitHub job', { error: String(err), eventType, repoFullName });
	}
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const PROCESSABLE_EVENTS = [
	'pull_request',
	'pull_request_review',
	'pull_request_review_comment',
	'issue_comment',
	'check_suite',
];

/**
 * Handle a POST /github/webhook request.
 * Parses the payload, filters irrelevant events, dispatches triggers,
 * and queues a job only when a trigger confirms a match.
 */
export async function handleGitHubWebhook(
	eventType: string,
	payload: unknown,
	triggerRegistry: TriggerRegistry,
): Promise<{ shouldProcess: boolean; repoFullName: string }> {
	const p = payload as Record<string, unknown>;
	const repo = p.repository as Record<string, unknown> | undefined;
	const repoFullName = (repo?.full_name as string) || 'unknown';

	const shouldProcess = PROCESSABLE_EVENTS.includes(eventType);

	if (shouldProcess) {
		await processGitHubWebhookEvent(eventType, repoFullName, payload, triggerRegistry);
	} else {
		logger.debug('Ignoring GitHub event', { eventType });
	}

	return { shouldProcess, repoFullName };
}
