import { TRPCError } from '@trpc/server';
import type { JiraWebhookInfo, ProjectContext, WebhookPlatformAdapter } from './types.js';

function jiraAuthHeader(ctx: ProjectContext): string {
	return `Basic ${Buffer.from(`${ctx.jiraEmail}:${ctx.jiraApiToken}`).toString('base64')}`;
}

async function jiraListWebhooks(ctx: ProjectContext): Promise<JiraWebhookInfo[]> {
	if (!ctx.jiraBaseUrl || !ctx.jiraEmail || !ctx.jiraApiToken) return [];
	const response = await fetch(`${ctx.jiraBaseUrl}/rest/api/3/webhook`, {
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

async function jiraCreateWebhook(
	ctx: ProjectContext,
	callbackURL: string,
): Promise<JiraWebhookInfo> {
	if (!ctx.jiraBaseUrl || !ctx.jiraEmail || !ctx.jiraApiToken) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'JIRA credentials not configured',
		});
	}
	const response = await fetch(`${ctx.jiraBaseUrl}/rest/api/3/webhook`, {
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
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Failed to create JIRA webhook: ${response.status} ${errorText}`,
		});
	}
	return (await response.json()) as JiraWebhookInfo;
}

async function jiraDeleteWebhook(ctx: ProjectContext, webhookId: number): Promise<void> {
	if (!ctx.jiraBaseUrl || !ctx.jiraEmail || !ctx.jiraApiToken) return;
	const response = await fetch(`${ctx.jiraBaseUrl}/rest/api/3/webhook`, {
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

	// Find one issue in the project
	const searchResponse = await fetch(
		`${ctx.jiraBaseUrl}/rest/api/3/search?jql=${encodeURIComponent(`project = "${ctx.jiraProjectKey}" ORDER BY created DESC`)}&maxResults=1&fields=labels`,
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
	const addResponse = await fetch(`${ctx.jiraBaseUrl}/rest/api/3/issue/${issue.key}`, {
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
	await fetch(`${ctx.jiraBaseUrl}/rest/api/3/issue/${issue.key}`, {
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

export class JiraWebhookAdapter implements WebhookPlatformAdapter<JiraWebhookInfo> {
	readonly type = 'jira' as const;

	async list(ctx: ProjectContext): Promise<JiraWebhookInfo[]> {
		return jiraListWebhooks(ctx);
	}

	async create(
		ctx: ProjectContext,
		baseUrl: string,
	): Promise<JiraWebhookInfo | string | undefined> {
		if (!ctx.jiraEmail || !ctx.jiraApiToken || !ctx.jiraBaseUrl) return undefined;

		const callbackUrl = `${baseUrl}/jira/webhook`;
		const existing = await jiraListWebhooks(ctx);
		const duplicate = existing.find(
			(w) => w.url === callbackUrl || w.url === `${baseUrl}/webhook/jira`,
		);

		if (duplicate) {
			return `Already exists: ${duplicate.id}`;
		}
		return jiraCreateWebhook(ctx, callbackUrl);
	}

	async delete(ctx: ProjectContext, baseUrl: string): Promise<number[]> {
		if (!ctx.jiraEmail || !ctx.jiraApiToken) return [];

		const callbackUrl = `${baseUrl}/jira/webhook`;
		const existing = await jiraListWebhooks(ctx);
		const matching = existing.filter(
			(w) => w.url === callbackUrl || w.url === `${baseUrl}/webhook/jira`,
		);
		const deleted: number[] = [];
		for (const w of matching) {
			await jiraDeleteWebhook(ctx, w.id);
			deleted.push(w.id);
		}
		return deleted;
	}
}
