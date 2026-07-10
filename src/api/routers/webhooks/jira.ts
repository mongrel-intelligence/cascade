import { TRPCError } from '@trpc/server';
import { resolveJiraApiBaseUrl } from '../../../jira/api-host.js';
import type { JiraCredentials } from '../../../jira/types.js';
import { logger } from '../../../utils/logging.js';
import type { JiraWebhookInfo, ProjectContext } from './types.js';

function jiraAuthHeader(ctx: ProjectContext): string {
	return `Basic ${Buffer.from(`${ctx.jiraEmail}:${ctx.jiraApiToken}`).toString('base64')}`;
}

/**
 * Build a `JiraCredentials` bag from the resolved `ProjectContext` so the shared
 * `resolveJiraApiBaseUrl` host resolver can pick the effective REST v3 base:
 *   - `basic` / absent `authType` ⇒ the tenant site URL (`ctx.jiraBaseUrl`).
 *   - `scoped` `authType`         ⇒ the Atlassian gateway
 *                                   (`https://api.atlassian.com/ex/jira/{cloudId}`).
 */
function jiraCredentialsFromContext(ctx: ProjectContext): JiraCredentials {
	return {
		email: ctx.jiraEmail ?? '',
		apiToken: ctx.jiraApiToken ?? '',
		baseUrl: ctx.jiraBaseUrl ?? '',
		authType: ctx.jiraAuthType,
	};
}

/**
 * Resolve the REST v3 base URL for this project's JIRA credentials. Every REST
 * v3 call in this module routes through the returned `apiBase` so scoped API
 * tokens hit the Atlassian gateway consistently. `/browse/...` UI URLs (which
 * this module never builds) must stay on the site URL, never the gateway.
 */
function resolveJiraRestBase(ctx: ProjectContext): Promise<string> {
	return resolveJiraApiBaseUrl(jiraCredentialsFromContext(ctx));
}

export async function jiraListWebhooks(ctx: ProjectContext): Promise<JiraWebhookInfo[]> {
	if (!ctx.jiraBaseUrl || !ctx.jiraEmail || !ctx.jiraApiToken) return [];
	const apiBase = await resolveJiraRestBase(ctx);
	const response = await fetch(`${apiBase}/rest/api/3/webhook`, {
		headers: {
			Authorization: jiraAuthHeader(ctx),
			Accept: 'application/json',
		},
	});
	if (!response.ok) {
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Failed to list JIRA webhooks: ${response.status}`,
		});
	}
	const data = (await response.json()) as { values?: JiraWebhookInfo[] };
	return data.values ?? [];
}

/**
 * Build an actionable message for a 401/403 rejection of the dynamic
 * webhook-create call.
 *
 * Scoped API tokens must carry explicit webhook scopes, and Atlassian
 * additionally restricts programmatic (dynamic) webhook registration to app
 * callers — both surface as 401 ("Unauthorized; scope does not match") or 403
 * (confirmed live in MNG-1735/MNG-1740). Rather than dumping a raw status, tell
 * the operator which scopes to add or to register the webhook manually. The
 * wizard renders this message on the mutation error.
 */
function scopedWebhookCreateMessage(
	status: number,
	callbackURL: string,
	siteUrl: string | undefined,
	errorText: string,
): string {
	const manualTarget = siteUrl
		? `${siteUrl} (System → WebHooks)`
		: 'your JIRA site settings (System → WebHooks)';
	const detail = errorText ? ` JIRA response: ${errorText}` : '';
	return (
		`JIRA declined to create the webhook (HTTP ${status}). Scoped API tokens must carry webhook ` +
		'scopes, and Atlassian may restrict programmatic webhook registration to app callers. Add the ' +
		'required scopes to your token (classic OAuth: read:jira-work + manage:jira-webhook; granular: ' +
		'read:field:jira + read:project:jira + write:webhook:jira), or register the webhook manually at ' +
		`${manualTarget} pointing to ${callbackURL}.${detail}`
	);
}

export async function jiraCreateWebhook(
	ctx: ProjectContext,
	callbackURL: string,
): Promise<JiraWebhookInfo> {
	if (!ctx.jiraBaseUrl || !ctx.jiraEmail || !ctx.jiraApiToken) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'JIRA credentials not configured',
		});
	}

	const apiBase = await resolveJiraRestBase(ctx);

	// Delete any existing webhooks with the same callback URL to prevent duplicates.
	// Like GitHub, JIRA can have webhooks from other integrations, so we only
	// delete webhooks matching our specific callback URL.
	//
	// Best-effort: a scope-restricted token may reject GET /webhook (401/403). In
	// that case we skip dedup and still attempt the create so its own actionable
	// error surfaces instead of a generic "failed to list" failure.
	let existingWebhooks: JiraWebhookInfo[] = [];
	try {
		existingWebhooks = await jiraListWebhooks(ctx);
	} catch (err) {
		logger.warn('[JiraWebhook] Could not list existing webhooks for dedup (continuing)', {
			projectId: ctx.projectId,
			jiraProjectKey: ctx.jiraProjectKey,
			error: String(err),
		});
	}
	for (const webhook of existingWebhooks) {
		if (webhook.url === callbackURL) {
			try {
				await jiraDeleteWebhook(ctx, webhook.id);
				logger.info('[JiraWebhook] Deleted existing webhook to prevent duplicates', {
					webhookId: webhook.id,
					projectId: ctx.projectId,
					jiraProjectKey: ctx.jiraProjectKey,
				});
			} catch (err) {
				// Log and continue — failing to delete shouldn't prevent creating a new one
				logger.warn('[JiraWebhook] Failed to delete existing webhook (continuing)', {
					webhookId: webhook.id,
					projectId: ctx.projectId,
					error: String(err),
				});
			}
		}
	}

	// Now create the new webhook
	const response = await fetch(`${apiBase}/rest/api/3/webhook`, {
		method: 'POST',
		headers: {
			Authorization: jiraAuthHeader(ctx),
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			url: callbackURL,
			webhooks: [
				{
					jqlFilter: '*',
					events: [
						'jira:issue_created',
						'jira:issue_updated',
						'comment_created',
						'comment_updated',
					],
				},
			],
		}),
	});
	if (!response.ok) {
		const errorText = await response.text().catch(() => '');
		// Scoped API tokens (and non-app callers) commonly get 401/403 from the
		// dynamic webhook API — surface an actionable scope / manual-registration
		// message rather than a raw status dump.
		if (response.status === 401 || response.status === 403) {
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: scopedWebhookCreateMessage(
					response.status,
					callbackURL,
					ctx.jiraBaseUrl,
					errorText,
				),
			});
		}
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Failed to create JIRA webhook: ${response.status} ${errorText}`,
		});
	}
	return (await response.json()) as JiraWebhookInfo;
}

export async function jiraDeleteWebhook(ctx: ProjectContext, webhookId: number): Promise<void> {
	if (!ctx.jiraBaseUrl || !ctx.jiraEmail || !ctx.jiraApiToken) return;
	const apiBase = await resolveJiraRestBase(ctx);
	const response = await fetch(`${apiBase}/rest/api/3/webhook`, {
		method: 'DELETE',
		headers: {
			Authorization: jiraAuthHeader(ctx),
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({ webhookIds: [webhookId] }),
	});
	if (!response.ok) {
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Failed to delete JIRA webhook ${webhookId}: ${response.status}`,
		});
	}
}

/**
 * Ensure CASCADE labels exist in JIRA's autocomplete by briefly adding them to
 * an issue and immediately removing them. JIRA auto-creates labels when first
 * used, but they won't appear in autocomplete until then.
 *
 * Returns the list of labels that were seeded, or an empty array if the project
 * has no issues yet.
 */
export async function jiraEnsureLabels(ctx: ProjectContext): Promise<string[]> {
	if (!ctx.jiraBaseUrl || !ctx.jiraEmail || !ctx.jiraApiToken || !ctx.jiraProjectKey) {
		return [];
	}

	const labelsToSeed = ctx.jiraLabels ?? [];
	if (labelsToSeed.length === 0) return [];

	const auth = jiraAuthHeader(ctx);
	const apiBase = await resolveJiraRestBase(ctx);

	// Find one issue in the project
	const searchResponse = await fetch(
		`${apiBase}/rest/api/3/search?jql=${encodeURIComponent(`project = "${ctx.jiraProjectKey}" ORDER BY created DESC`)}&maxResults=1&fields=labels`,
		{
			headers: { Authorization: auth, Accept: 'application/json' },
		},
	);

	if (!searchResponse.ok) return [];

	const searchData = (await searchResponse.json()) as {
		issues?: Array<{ key: string; fields?: { labels?: string[] } }>;
	};

	const issue = searchData.issues?.[0];
	if (!issue) {
		// No issues in the project yet — labels will be created when first agent runs
		return [];
	}

	const existingLabels = issue.fields?.labels ?? [];
	const newLabels = labelsToSeed.filter((l) => !existingLabels.includes(l));

	if (newLabels.length === 0) {
		// All labels already exist in the project
		return labelsToSeed;
	}

	// Add all CASCADE labels to the issue
	const addResponse = await fetch(`${apiBase}/rest/api/3/issue/${issue.key}`, {
		method: 'PUT',
		headers: {
			Authorization: auth,
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			fields: {
				labels: [...existingLabels, ...newLabels],
			},
		}),
	});

	if (!addResponse.ok) return [];

	// Immediately restore original labels
	await fetch(`${apiBase}/rest/api/3/issue/${issue.key}`, {
		method: 'PUT',
		headers: {
			Authorization: auth,
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			fields: {
				labels: existingLabels,
			},
		}),
	});

	return labelsToSeed;
}
