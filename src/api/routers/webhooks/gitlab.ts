/**
 * GitLab webhook CRUD operations.
 *
 * Uses raw `fetch()` with the PRIVATE-TOKEN header — same pattern as the
 * router platform client (`src/router/platformClients/gitlab.ts`).
 */

import { logger } from '../../../utils/logging.js';
import type { GitLabWebhookInfo, ProjectContext } from './types.js';

/** Events CASCADE needs from GitLab webhooks. */
const GITLAB_WEBHOOK_EVENTS = {
	push_events: true,
	merge_requests_events: true,
	pipeline_events: true,
	note_events: true,
} as const;

function getGitLabApiBase(ctx: ProjectContext): string {
	const host = ctx.gitlabHost ?? 'https://gitlab.com';
	return `${host.replace(/\/$/, '')}/api/v4`;
}

function encodedProjectPath(ctx: ProjectContext): string {
	if (!ctx.repo) {
		throw new Error('Cannot manage GitLab webhooks: no repo (project path) configured');
	}
	return encodeURIComponent(ctx.repo);
}

function headers(ctx: ProjectContext): Record<string, string> {
	return {
		'PRIVATE-TOKEN': ctx.gitlabToken,
		'Content-Type': 'application/json',
	};
}

interface GitLabHookApiResponse {
	id: number;
	url: string;
	enable_ssl_verification: boolean;
	push_events: boolean;
	merge_requests_events: boolean;
	pipeline_events: boolean;
	note_events: boolean;
	[key: string]: unknown;
}

function mapHook(hook: GitLabHookApiResponse): GitLabWebhookInfo {
	return {
		id: hook.id,
		url: hook.url,
		enableSslVerification: hook.enable_ssl_verification,
		pushEvents: hook.push_events,
		mergeRequestsEvents: hook.merge_requests_events,
		pipelineEvents: hook.pipeline_events,
		noteEvents: hook.note_events,
	};
}

export async function gitlabListWebhooks(ctx: ProjectContext): Promise<GitLabWebhookInfo[]> {
	if (!ctx.gitlabToken) return [];
	if (!ctx.repo) return [];

	const base = getGitLabApiBase(ctx);
	const path = encodedProjectPath(ctx);
	const url = `${base}/projects/${path}/hooks`;

	const response = await fetch(url, {
		method: 'GET',
		headers: headers(ctx),
	});

	if (!response.ok) {
		const body = await response.text();
		logger.warn('[GitLabWebhook] Failed to list webhooks', {
			status: response.status,
			body,
			projectId: ctx.projectId,
		});
		throw new Error(`GitLab API returned ${response.status}: ${body}`);
	}

	const data = (await response.json()) as GitLabHookApiResponse[];
	return data.map(mapHook);
}

export async function gitlabCreateWebhook(
	ctx: ProjectContext,
	callbackURL: string,
): Promise<GitLabWebhookInfo> {
	if (!ctx.repo) {
		throw new Error('Cannot create GitLab webhook: no repo (project path) configured');
	}

	// Delete any existing webhooks with the same callback URL to prevent duplicates.
	const existingWebhooks = await gitlabListWebhooks(ctx);
	for (const webhook of existingWebhooks) {
		if (webhook.url === callbackURL) {
			try {
				await gitlabDeleteWebhook(ctx, webhook.id);
				logger.info('[GitLabWebhook] Deleted existing webhook to prevent duplicates', {
					webhookId: webhook.id,
					projectId: ctx.projectId,
					repo: ctx.repo,
				});
			} catch (err) {
				logger.warn('[GitLabWebhook] Failed to delete existing webhook (continuing)', {
					webhookId: webhook.id,
					projectId: ctx.projectId,
					error: String(err),
				});
			}
		}
	}

	const base = getGitLabApiBase(ctx);
	const path = encodedProjectPath(ctx);
	const url = `${base}/projects/${path}/hooks`;

	const body: Record<string, unknown> = {
		url: callbackURL,
		...GITLAB_WEBHOOK_EVENTS,
	};

	// GitLab sends the token as X-Gitlab-Token header on each delivery
	if (ctx.gitlabWebhookSecret) {
		body.token = ctx.gitlabWebhookSecret;
	}

	const response = await fetch(url, {
		method: 'POST',
		headers: headers(ctx),
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const respBody = await response.text();
		throw new Error(`GitLab API returned ${response.status}: ${respBody}`);
	}

	const data = (await response.json()) as GitLabHookApiResponse;
	return mapHook(data);
}

export async function gitlabDeleteWebhook(ctx: ProjectContext, hookId: number): Promise<void> {
	if (!ctx.repo) {
		throw new Error('Cannot delete GitLab webhook: no repo (project path) configured');
	}

	const base = getGitLabApiBase(ctx);
	const path = encodedProjectPath(ctx);
	const url = `${base}/projects/${path}/hooks/${hookId}`;

	const response = await fetch(url, {
		method: 'DELETE',
		headers: { 'PRIVATE-TOKEN': ctx.gitlabToken },
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`GitLab API returned ${response.status}: ${body}`);
	}
}
