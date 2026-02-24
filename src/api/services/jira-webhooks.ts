import { TRPCError } from '@trpc/server';
import type { JiraWebhookInfo, WebhookManager } from './types.js';

interface JiraContext {
	jiraBaseUrl?: string;
	jiraEmail?: string;
	jiraApiToken?: string;
	jiraProjectKey?: string;
	jiraLabels?: string[];
}

export class JiraWebhookManager implements WebhookManager<JiraWebhookInfo, number> {
	constructor(private readonly ctx: JiraContext) {}

	private authHeader(): string {
		return `Basic ${Buffer.from(`${this.ctx.jiraEmail}:${this.ctx.jiraApiToken}`).toString('base64')}`;
	}

	async list(): Promise<JiraWebhookInfo[]> {
		const { jiraBaseUrl, jiraEmail, jiraApiToken } = this.ctx;
		if (!jiraBaseUrl || !jiraEmail || !jiraApiToken) return [];

		const response = await fetch(`${jiraBaseUrl}/rest/api/3/webhook`, {
			headers: {
				Authorization: this.authHeader(),
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

	async create(callbackURL: string): Promise<JiraWebhookInfo> {
		const { jiraBaseUrl, jiraEmail, jiraApiToken } = this.ctx;
		if (!jiraBaseUrl || !jiraEmail || !jiraApiToken) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'JIRA credentials not configured',
			});
		}
		const response = await fetch(`${jiraBaseUrl}/rest/api/3/webhook`, {
			method: 'POST',
			headers: {
				Authorization: this.authHeader(),
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

	async delete(webhookId: number): Promise<void> {
		const { jiraBaseUrl, jiraEmail, jiraApiToken } = this.ctx;
		if (!jiraBaseUrl || !jiraEmail || !jiraApiToken) return;

		const response = await fetch(`${jiraBaseUrl}/rest/api/3/webhook`, {
			method: 'DELETE',
			headers: {
				Authorization: this.authHeader(),
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
	async ensureLabels(): Promise<string[]> {
		const { jiraBaseUrl, jiraEmail, jiraApiToken, jiraProjectKey } = this.ctx;
		if (!jiraBaseUrl || !jiraEmail || !jiraApiToken || !jiraProjectKey) {
			return [];
		}

		const labelsToSeed = this.ctx.jiraLabels ?? [];
		if (labelsToSeed.length === 0) return [];

		const auth = this.authHeader();

		// Find one issue in the project
		const searchResponse = await fetch(
			`${jiraBaseUrl}/rest/api/3/search?jql=${encodeURIComponent(`project = "${jiraProjectKey}" ORDER BY created DESC`)}&maxResults=1&fields=labels`,
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
		const addResponse = await fetch(`${jiraBaseUrl}/rest/api/3/issue/${issue.key}`, {
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
		await fetch(`${jiraBaseUrl}/rest/api/3/issue/${issue.key}`, {
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
}
