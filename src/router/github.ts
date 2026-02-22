/**
 * GitHub webhook handler for the router (multi-container) deployment mode.
 *
 * Handles webhook parsing, self-comment filtering, ack posting, pre-actions,
 * and job queuing for GitHub webhook events.
 */

import { INITIAL_MESSAGES } from '../config/agentMessages.js';
import { findProjectByRepo } from '../config/provider.js';
import {
	type PersonaIdentities,
	isCascadeBot,
	resolvePersonaIdentities,
} from '../github/personas.js';
import type { TriggerRegistry } from '../triggers/registry.js';
import type { TriggerContext } from '../types/index.js';
import { postGitHubAck, resolveGitHubTokenForAck } from './acknowledgments.js';
import { loadProjectConfig } from './config.js';
import { extractPRNumber } from './notifications.js';
import { addEyesReactionToPR } from './pre-actions.js';
import { type CascadeJob, type GitHubJob, addJob } from './queue.js';
import { sendAcknowledgeReaction } from './reactions.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Try to match a trigger and post an ack comment for a GitHub webhook.
 * Returns the ack comment ID if posted, undefined otherwise.
 */
export async function tryPostGitHubAck(
	eventType: string,
	repoFullName: string,
	payload: unknown,
	triggerRegistry: TriggerRegistry,
): Promise<number | undefined> {
	const config = await loadProjectConfig();
	const fullProject = config.fullProjects.find((fp) => fp.repo === repoFullName);
	if (!fullProject) return undefined;

	let personaIdentities: PersonaIdentities | undefined;
	try {
		personaIdentities = await resolvePersonaIdentities(fullProject.id);
	} catch {
		// Persona resolution may fail — proceed without ack
	}

	const ctx: TriggerContext = {
		project: fullProject,
		source: 'github',
		payload,
		personaIdentities,
	};
	const match = triggerRegistry.matchTrigger(ctx);
	if (!match) return undefined;

	const message = INITIAL_MESSAGES[match.agentType];
	if (!message) return undefined;

	const resolved = await resolveGitHubTokenForAck(repoFullName);
	if (!resolved) return undefined;

	const tempJob = { eventType, repoFullName, payload } as GitHubJob;
	const prNumber = extractPRNumber(tempJob);
	if (!prNumber) return undefined;

	const commentId = await postGitHubAck(repoFullName, prNumber, message, resolved.token);
	return commentId ?? undefined;
}

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
				console.warn('[Router] No project found for repo, skipping GitHub reaction', {
					repoFullName,
				});
				return;
			}
			const personaIdentities = await resolvePersonaIdentities(project.id);
			await sendAcknowledgeReaction('github', repoFullName, payload, personaIdentities, project);
		} catch (err) {
			console.warn('[Router] GitHub reaction error:', String(err));
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
			console.warn('[Router] Pre-action error (eyes reaction):', String(err)),
		);
	}
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
		console.log('[Router] Ignoring self-authored GitHub comment');
		return;
	}

	console.log('[Router] Queueing GitHub job:', { eventType, repoFullName });

	// Fire-and-forget acknowledgment reaction — only for comment events that @mention the bot
	if (isCommentEvent) {
		fireGitHubAckReaction(repoFullName, payload);
	}

	// Try to post an ack comment via trigger matching (non-blocking best-effort)
	let ackCommentId: number | undefined;
	try {
		ackCommentId = await tryPostGitHubAck(eventType, repoFullName, payload, triggerRegistry);
	} catch (err) {
		console.warn('[Router] GitHub ack comment failed (non-fatal):', String(err));
	}

	const job: CascadeJob = {
		type: 'github',
		source: 'github',
		payload,
		eventType,
		repoFullName,
		receivedAt: new Date().toISOString(),
		ackCommentId,
	};

	// Fire pre-actions (non-blocking) before queueing
	const p = payload as Record<string, unknown>;
	firePreActions(job as GitHubJob, p);

	try {
		const jobId = await addJob(job);
		console.log('[Router] GitHub job queued:', { jobId, eventType, ackCommentId });
	} catch (err) {
		console.error('[Router] Failed to queue GitHub job:', err);
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
 * Parses the payload, filters irrelevant events, and queues a job.
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
		console.log('[Router] Ignoring GitHub event:', eventType);
	}

	return { shouldProcess, repoFullName };
}
