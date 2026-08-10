/**
 * GitHub Projects webhook management (organization-owned projects only).
 *
 * `projects_v2_item` is a valid **organization** webhook event, so org-owned
 * projects can register the CASCADE webhook programmatically via
 * `POST /orgs/{org}/hooks` — mirroring the repo-hook pattern in `./github.ts`.
 *
 * User-owned Projects have no webhook-management API; for those the wizard falls
 * back to manual setup instructions. These helpers therefore no-op (list) or
 * throw an actionable error (create) unless the owner is an organization.
 */

import { Octokit } from '@octokit/rest';
import { TRPCError } from '@trpc/server';
import { logger } from '../../../utils/logging.js';
import type { GitHubWebhook, ProjectContext } from './types.js';

/** The single org-hook event CASCADE subscribes to for Projects v2. */
export const GITHUB_PROJECTS_WEBHOOK_EVENTS = ['projects_v2_item'];

/** True when this project's GitHub Project is org-owned and has a usable token. */
function canManageOrgWebhooks(ctx: ProjectContext): boolean {
	return (
		ctx.pmType === 'github-projects' &&
		ctx.githubProjectsOwnerType === 'organization' &&
		Boolean(ctx.githubProjectsOwner) &&
		Boolean(ctx.githubProjectsToken)
	);
}

/**
 * Translate an Octokit error on an org-hook call into an actionable message.
 * A token missing the `admin:org_hook` scope (or a non-admin) gets 403/404.
 */
function orgHookErrorMessage(org: string, err: unknown): string {
	const status = (err as { status?: number })?.status;
	if (status === 403 || status === 404) {
		return (
			`GitHub declined to manage webhooks for organization "${org}" (HTTP ${status}). The token ` +
			'needs the "admin:org_hook" scope and organization-owner/admin access. Add the scope, or ' +
			'register the webhook manually in Organization Settings → Webhooks.'
		);
	}
	return `GitHub webhook operation failed for organization "${org}": ${String(err)}`;
}

export async function githubProjectsListWebhooks(ctx: ProjectContext): Promise<GitHubWebhook[]> {
	if (!canManageOrgWebhooks(ctx)) return [];
	const octokit = new Octokit({ auth: ctx.githubProjectsToken });
	try {
		const { data } = await octokit.orgs.listWebhooks({ org: ctx.githubProjectsOwner as string });
		return data as GitHubWebhook[];
	} catch (err) {
		// Listing is best-effort (used for dedup + UI). A scope-limited token should
		// not break the wizard — surface [] and let create() report the real error.
		logger.warn('[GitHubProjectsWebhook] Could not list org webhooks (continuing)', {
			projectId: ctx.projectId,
			org: ctx.githubProjectsOwner,
			error: String(err),
		});
		return [];
	}
}

export async function githubProjectsCreateWebhook(
	ctx: ProjectContext,
	callbackURL: string,
): Promise<GitHubWebhook> {
	if (ctx.githubProjectsOwnerType !== 'organization' || !ctx.githubProjectsOwner) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message:
				'Programmatic webhook creation is only available for organization-owned GitHub Projects. ' +
				'User-owned projects must be configured manually (Organization Settings → Webhooks of an ' +
				'org that owns the project, or a GitHub App subscribed to projects_v2_item).',
		});
	}
	if (!ctx.githubProjectsToken) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'GitHub Projects token not configured' });
	}

	const org = ctx.githubProjectsOwner;
	const octokit = new Octokit({ auth: ctx.githubProjectsToken });

	// Delete any existing webhook with the same callback URL to prevent duplicates
	// (org webhooks may include hooks from other integrations, so only match ours).
	const existing = await githubProjectsListWebhooks(ctx);
	for (const webhook of existing) {
		if (webhook.config?.url === callbackURL) {
			try {
				await githubProjectsDeleteWebhook(ctx, webhook.id);
				logger.info('[GitHubProjectsWebhook] Deleted existing webhook to prevent duplicates', {
					webhookId: webhook.id,
					projectId: ctx.projectId,
					org,
				});
			} catch (err) {
				logger.warn('[GitHubProjectsWebhook] Failed to delete existing webhook (continuing)', {
					webhookId: webhook.id,
					projectId: ctx.projectId,
					error: String(err),
				});
			}
		}
	}

	const webhookConfig: { url: string; content_type: string; secret?: string } = {
		url: callbackURL,
		content_type: 'json',
	};
	// Sign with the PM provider's own webhook secret (GITHUB_PROJECTS_WEBHOOK_SECRET),
	// NOT the SCM `github` role's GITHUB_WEBHOOK_SECRET (ctx.webhookSecret). The router
	// verifies incoming `projects_v2_item` events against this provider's `webhook_secret`
	// role via `resolveWebhookSecret('github-projects')`, and the wizard's ProjectSecretField
	// persists the operator-supplied secret under the same key — so signing with anything
	// else would make every delivered event fail signature verification (401).
	if (ctx.githubProjectsWebhookSecret) {
		webhookConfig.secret = ctx.githubProjectsWebhookSecret;
	}

	try {
		const { data } = await octokit.orgs.createWebhook({
			org,
			name: 'web',
			config: webhookConfig,
			events: GITHUB_PROJECTS_WEBHOOK_EVENTS,
			active: true,
		});
		return data as GitHubWebhook;
	} catch (err) {
		throw new TRPCError({ code: 'FORBIDDEN', message: orgHookErrorMessage(org, err) });
	}
}

export async function githubProjectsDeleteWebhook(
	ctx: ProjectContext,
	hookId: number,
): Promise<void> {
	if (ctx.githubProjectsOwnerType !== 'organization' || !ctx.githubProjectsOwner) return;
	if (!ctx.githubProjectsToken) return;
	const octokit = new Octokit({ auth: ctx.githubProjectsToken });
	await octokit.orgs.deleteWebhook({ org: ctx.githubProjectsOwner, hook_id: hookId });
}
