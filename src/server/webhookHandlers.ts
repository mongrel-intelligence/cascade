/**
 * Generic webhook handler factory for Trello, GitHub, and JIRA endpoints.
 *
 * Eliminates the three near-identical 50-60 line POST handler blocks that
 * previously existed in both `src/server.ts` and `src/router/index.ts` by
 * extracting the shared flow (capacity check, header extraction, parse,
 * log, react, process) into a single parameterized factory.
 *
 * Supports two processing modes via `fireAndForget`:
 * - `true` (default, server mode): respond 200 immediately, process later.
 * - `false` (router mode): await processing so 200 means "job queued."
 *
 * Supports log enrichment via `resolveLogFields` so callers can override
 * the `processed` and `projectId` fields based on actual processing outcome.
 */

import type { Context, Handler } from 'hono';
import { findProjectByRepo } from '../config/provider.js';
import { resolvePersonaIdentities } from '../github/personas.js';
import { sendAcknowledgeReaction } from '../router/reactions.js';
import { extractRawHeaders, parseGitHubWebhookPayload } from '../router/webhookParsing.js';
import type { CascadeConfig } from '../types/index.js';
import { canAcceptWebhook, isCurrentlyProcessing, logger } from '../utils/index.js';
import { logWebhookCall } from '../utils/webhookLogger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result returned by a payload parser. */
export type ParseResult =
	| { ok: true; payload: unknown; eventType?: string }
	| { ok: false; error: string; eventType?: string };

/** Fields that `resolveLogFields` may override in the webhook log entry. */
export interface WebhookLogOverrides {
	processed?: boolean;
	projectId?: string;
}

/**
 * Configuration object that drives a platform-specific webhook handler.
 * Each platform provides implementations for parsing and reaction dispatching;
 * the factory handles the common scaffolding around them.
 */
export interface WebhookHandlerConfig {
	/** Platform label used for logging and webhook log source field. */
	source: 'trello' | 'github' | 'jira';

	/**
	 * Parse the raw Hono request into a structured payload.
	 * Return `{ ok: false, error }` to short-circuit with a 400 response.
	 */
	parsePayload: (c: Context) => Promise<ParseResult>;

	/**
	 * Fire-and-forget acknowledgment reaction.
	 * Called only when `parsePayload` succeeds.
	 * Errors are caught internally — must never propagate.
	 */
	sendReaction?: (payload: unknown, eventType: string | undefined) => void;

	/**
	 * Processing callback. By default invoked via `setImmediate` (fire-and-forget)
	 * after a 200 is returned to the caller. When `fireAndForget` is `false`, the
	 * handler awaits this callback before responding — useful when processing must
	 * complete (e.g. job queuing) before acknowledging the webhook.
	 */
	processWebhook: (payload: unknown, eventType: string | undefined) => Promise<void>;

	/**
	 * Whether to apply the global capacity gate (isCurrentlyProcessing &&
	 * !canAcceptWebhook → 503).  Set to `false` for the router deployment
	 * mode which handles back-pressure differently.
	 * Defaults to `true`.
	 */
	checkCapacity?: boolean;

	/**
	 * Whether to schedule `processWebhook` asynchronously via `setImmediate`
	 * (fire-and-forget) or await it before responding.
	 *
	 * - `true` (default) — server mode: respond 200 immediately, process later.
	 * - `false` — router mode: await processing so 200 means "job queued."
	 */
	fireAndForget?: boolean;

	/**
	 * Optional callback to enrich the webhook log entry after a successful parse.
	 * Called with the parsed payload and event type; returns fields to override in
	 * the log (e.g. `processed`, `projectId`).
	 *
	 * When `fireAndForget` is `false`, this is called after `processWebhook`
	 * completes, allowing log fields to reflect actual processing outcome.
	 * When `fireAndForget` is `true`, it is called before processing starts.
	 */
	resolveLogFields?: (
		payload: unknown,
		eventType: string | undefined,
	) => WebhookLogOverrides | Promise<WebhookLogOverrides>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Log a successful webhook call, optionally enriched by resolveLogFields. */
async function logSuccessfulWebhook(
	source: WebhookHandlerConfig['source'],
	c: Context,
	rawHeaders: Record<string, string>,
	payload: unknown,
	eventType: string | undefined,
	resolveLogFields: WebhookHandlerConfig['resolveLogFields'],
): Promise<void> {
	const logOverrides = resolveLogFields ? await resolveLogFields(payload, eventType) : undefined;
	logWebhookCall({
		source,
		method: c.req.method,
		path: c.req.path,
		headers: rawHeaders,
		body: payload,
		statusCode: 200,
		eventType,
		processed: logOverrides?.processed ?? true,
		projectId: logOverrides?.projectId,
	});
}

/** Wrap processWebhook with standard error logging. */
function handleProcessingError(source: WebhookHandlerConfig['source'], err: unknown): void {
	logger.error(`Error processing ${source} webhook`, {
		error: String(err),
		stack: err instanceof Error ? err.stack : undefined,
	});
}

/**
 * Build a Hono POST handler for a webhook endpoint.
 *
 * The handler:
 * 1. Optionally checks machine capacity (503 if over limit).
 * 2. Parses the request payload via `config.parsePayload`.
 * 3. Logs the webhook call to the database (both success and failure paths).
 * 4. Fires a fire-and-forget acknowledgment reaction on success.
 * 5. Processes the webhook (fire-and-forget or awaited, per `fireAndForget`).
 * 6. Returns 200 immediately (or 400/503 on failure).
 */
export function createWebhookHandler(config: WebhookHandlerConfig): Handler {
	const {
		source,
		parsePayload,
		sendReaction,
		processWebhook,
		checkCapacity = true,
		fireAndForget = true,
		resolveLogFields,
	} = config;

	return async (c: Context) => {
		// --- Capacity gate (server mode only) ---
		if (checkCapacity && isCurrentlyProcessing() && !canAcceptWebhook()) {
			logger.warn('Machine at capacity, returning 503');
			return c.text('Service Unavailable', 503);
		}

		const rawHeaders = extractRawHeaders(c);

		// --- Parse ---
		const parseResult = await parsePayload(c);

		if (!parseResult.ok) {
			logger.error(`Failed to parse ${source} webhook`, { error: parseResult.error });
			logWebhookCall({
				source,
				method: c.req.method,
				path: c.req.path,
				headers: rawHeaders,
				bodyRaw: parseResult.error,
				statusCode: 400,
				eventType: parseResult.eventType,
				processed: false,
			});
			return c.text('Bad Request', 400);
		}

		const { payload, eventType } = parseResult;

		// --- Reaction (fire-and-forget) ---
		if (sendReaction) {
			sendReaction(payload, eventType);
		}

		if (fireAndForget) {
			// --- Log then process asynchronously (server mode) ---
			await logSuccessfulWebhook(source, c, rawHeaders, payload, eventType, resolveLogFields);
			setImmediate(() => {
				processWebhook(payload, eventType).catch((err) => handleProcessingError(source, err));
			});
		} else {
			// --- Await processing then log (router mode) ---
			// Process synchronously so 200 means "job queued."
			await processWebhook(payload, eventType).catch((err) => handleProcessingError(source, err));
			await logSuccessfulWebhook(source, c, rawHeaders, payload, eventType, resolveLogFields);
		}

		return c.text('OK', 200);
	};
}

// ---------------------------------------------------------------------------
// Platform-specific parser helpers
// ---------------------------------------------------------------------------

/**
 * Parse a Trello webhook request (plain JSON).
 * Extracts `action.type` as the event type.
 */
export async function parseTrelloPayload(c: Context): Promise<ParseResult> {
	try {
		const payload = await c.req.json();
		const eventType = (payload as Record<string, unknown>)?.action
			? ((payload as Record<string, Record<string, unknown>>).action.type as string | undefined)
			: undefined;
		logger.debug('Received Trello webhook', { action: eventType });
		return { ok: true, payload, eventType };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

/**
 * Parse a GitHub webhook request (JSON or form-encoded).
 * Event type comes from the `X-GitHub-Event` header.
 */
export async function parseGitHubPayload(c: Context): Promise<ParseResult> {
	const eventType = c.req.header('X-GitHub-Event') || 'unknown';
	const contentType = c.req.header('Content-Type') || '';
	const result = await parseGitHubWebhookPayload(c, contentType);
	if (!result.ok) {
		logger.error('Failed to parse GitHub webhook', {
			error: result.error,
			contentType,
			eventType,
		});
		return { ok: false, error: result.error, eventType };
	}
	const payload = result.payload;
	logger.info('Received GitHub webhook', {
		event: eventType,
		contentType,
		action: (payload as Record<string, unknown>)?.action,
		repository: ((payload as Record<string, unknown>)?.repository as Record<string, unknown>)
			?.full_name,
	});
	return { ok: true, payload, eventType };
}

/**
 * Parse a JIRA webhook request (plain JSON).
 * Extracts `webhookEvent` as the event type.
 */
export async function parseJiraPayload(c: Context): Promise<ParseResult> {
	try {
		const payload = await c.req.json();
		const eventType = (payload as Record<string, unknown>)?.webhookEvent as string | undefined;
		logger.info('Received JIRA webhook', {
			event: eventType,
			issueKey: ((payload as Record<string, unknown>)?.issue as Record<string, unknown>)?.key,
		});
		return { ok: true, payload, eventType };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

// ---------------------------------------------------------------------------
// Platform-specific reaction helpers (fire-and-forget wrappers)
// ---------------------------------------------------------------------------

/**
 * Build a fire-and-forget Trello reaction sender.
 * Only reacts on `commentCard` events.
 */
export function buildTrelloReactionSender(
	config: CascadeConfig,
): (payload: unknown, eventType: string | undefined) => void {
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
 * Build a fire-and-forget GitHub reaction sender.
 * Only reacts on `issue_comment` or `pull_request_review_comment` events.
 */
export function buildGitHubReactionSender(): (
	payload: unknown,
	eventType: string | undefined,
) => void {
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
 * Build a fire-and-forget JIRA reaction sender.
 * Only reacts on events whose name starts with `comment_`.
 */
export function buildJiraReactionSender(
	config: CascadeConfig,
): (payload: unknown, eventType: string | undefined) => void {
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
