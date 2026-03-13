/**
 * JIRA client using jira.js Version3Client.
 *
 * Same AsyncLocalStorage pattern as the Trello client — credentials
 * are scoped per-request via withJiraCredentials().
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Version3Client } from 'jira.js';
import { logger } from '../utils/logging.js';
import type { JiraCredentials } from './types.js';

const jiraCredentialStore = new AsyncLocalStorage<JiraCredentials>();

export function withJiraCredentials<T>(creds: JiraCredentials, fn: () => Promise<T>): Promise<T> {
	return jiraCredentialStore.run(creds, fn);
}

export function getJiraCredentials(): JiraCredentials {
	const scoped = jiraCredentialStore.getStore();
	if (!scoped) {
		throw new Error(
			'No JIRA credentials in scope. Wrap the call with withJiraCredentials() or ensure per-project JIRA_EMAIL/JIRA_API_TOKEN/JIRA_BASE_URL are set in the database.',
		);
	}
	return scoped;
}

function getClient(): Version3Client {
	const creds = getJiraCredentials();
	return new Version3Client({
		host: creds.baseUrl,
		authentication: {
			basic: {
				email: creds.email,
				apiToken: creds.apiToken,
			},
		},
	});
}

let cachedCloudId: string | null = null;

/** @internal Visible for testing only */
export function _resetCloudIdCache(): void {
	cachedCloudId = null;
}

export const jiraClient = {
	async getIssue(issueKey: string) {
		logger.debug('Fetching JIRA issue', { issueKey });
		return getClient().issues.getIssue({
			issueIdOrKey: issueKey,
			fields: [
				'summary',
				'description',
				'status',
				'labels',
				'issuetype',
				'subtasks',
				'attachment',
				'comment',
			],
		});
	},

	async getIssueComments(issueKey: string) {
		logger.debug('Fetching JIRA issue comments', { issueKey });
		const result = await getClient().issueComments.getComments({
			issueIdOrKey: issueKey,
			orderBy: '-created',
		});
		return result.comments ?? [];
	},

	async updateIssue(issueKey: string, updates: { summary?: string; description?: unknown }) {
		logger.debug('Updating JIRA issue', { issueKey });
		const fields: Record<string, unknown> = {};
		if (updates.summary) fields.summary = updates.summary;
		if (updates.description) fields.description = updates.description;
		await getClient().issues.editIssue({
			issueIdOrKey: issueKey,
			fields,
		});
	},

	async addComment(issueKey: string, body: unknown): Promise<string> {
		logger.debug('Adding JIRA comment', { issueKey });
		const result = await getClient().issueComments.addComment({
			issueIdOrKey: issueKey,
			comment: body as Parameters<Version3Client['issueComments']['addComment']>[0]['comment'],
		});
		return (result as { id?: string })?.id ?? '';
	},

	async updateComment(issueKey: string, commentId: string, body: unknown): Promise<void> {
		logger.debug('Updating JIRA comment', { issueKey, commentId });
		await getClient().issueComments.updateComment({
			issueIdOrKey: issueKey,
			id: commentId,
			body: body as Parameters<Version3Client['issueComments']['updateComment']>[0]['body'],
		});
	},

	async getIssueTypesForProject(projectKey: string): Promise<{ name: string; subtask: boolean }[]> {
		logger.debug('Fetching JIRA issue types for project', { projectKey });
		const project = await getClient().projects.getProject({
			projectIdOrKey: projectKey,
		});
		const types = (project.issueTypes ?? []) as { name?: string; subtask?: boolean }[];
		return types.map((t) => ({
			name: t.name ?? '',
			subtask: t.subtask ?? false,
		}));
	},

	async searchProjects(): Promise<Array<{ key: string; name: string }>> {
		logger.debug('Searching JIRA projects');
		const result = await getClient().projects.searchProjects({ maxResults: 100 });
		const values = (result.values ?? []) as Array<{ key?: string; name?: string }>;
		return values.map((p) => ({
			key: p.key ?? '',
			name: p.name ?? '',
		}));
	},

	async getProjectStatuses(projectKey: string): Promise<Array<{ name: string; id: string }>> {
		logger.debug('Fetching JIRA project statuses', { projectKey });
		const result = await getClient().projects.getAllStatuses({
			projectIdOrKey: projectKey,
		});
		// getAllStatuses returns issueType-grouped statuses; flatten and deduplicate
		const seen = new Set<string>();
		const statuses: Array<{ name: string; id: string }> = [];
		for (const issueType of result as Array<{
			statuses?: Array<{ name?: string; id?: string }>;
		}>) {
			for (const status of issueType.statuses ?? []) {
				const name = status.name ?? '';
				if (name && !seen.has(name)) {
					seen.add(name);
					statuses.push({ name, id: status.id ?? '' });
				}
			}
		}
		return statuses;
	},

	async getFields(): Promise<Array<{ id: string; name: string; custom: boolean }>> {
		logger.debug('Fetching JIRA fields');
		const fields = await getClient().issueFields.getFields();
		return (fields as Array<{ id?: string; name?: string; custom?: boolean }>).map((f) => ({
			id: f.id ?? '',
			name: f.name ?? '',
			custom: f.custom ?? false,
		}));
	},

	async createIssue(fields: Record<string, unknown>) {
		logger.debug('Creating JIRA issue', {
			project: (fields.project as { key?: string })?.key,
		});
		try {
			return await getClient().issues.createIssue({
				fields: fields as Parameters<Version3Client['issues']['createIssue']>[0]['fields'],
			});
		} catch (error: unknown) {
			const project = (fields.project as { key?: string })?.key;
			const issueType = (fields.issuetype as { name?: string })?.name;
			const detail =
				error instanceof Object && 'response' in error
					? (error as { response?: { data?: unknown } }).response?.data
					: undefined;
			const detailStr = detail ? ` — JIRA response: ${JSON.stringify(detail)}` : '';
			const message = error instanceof Error ? error.message : String(error);

			logger.error('JIRA createIssue failed', { project, issueType, detail });

			throw new Error(
				`JIRA createIssue failed (project=${project}, type=${issueType}): ${message}${detailStr}`,
			);
		}
	},

	async transitionIssue(issueKey: string, transitionId: string) {
		logger.debug('Transitioning JIRA issue', { issueKey, transitionId });
		await getClient().issues.doTransition({
			issueIdOrKey: issueKey,
			transition: { id: transitionId },
		});
	},

	async getTransitions(issueKey: string) {
		logger.debug('Fetching JIRA transitions', { issueKey });
		const result = await getClient().issues.getTransitions({ issueIdOrKey: issueKey });
		return result.transitions ?? [];
	},

	async updateLabels(issueKey: string, labels: string[]) {
		logger.debug('Updating JIRA issue labels', { issueKey, labels });
		await getClient().issues.editIssue({
			issueIdOrKey: issueKey,
			fields: { labels },
		});
	},

	async getIssueLabels(issueKey: string): Promise<string[]> {
		const issue = await getClient().issues.getIssue({
			issueIdOrKey: issueKey,
			fields: ['labels'],
		});
		return (issue.fields?.labels as string[]) ?? [];
	},

	async searchIssues(jql: string, fields: string[] = ['summary', 'status', 'labels']) {
		logger.debug('Searching JIRA issues', { jql });
		const result = await getClient().issueSearch.searchForIssuesUsingJql({
			jql,
			fields,
		});
		return result.issues ?? [];
	},

	async getCustomFieldValue(issueKey: string, fieldId: string): Promise<unknown> {
		const issue = await getClient().issues.getIssue({
			issueIdOrKey: issueKey,
			fields: [fieldId],
		});
		return issue.fields?.[fieldId];
	},

	async updateCustomField(issueKey: string, fieldId: string, value: unknown) {
		await getClient().issues.editIssue({
			issueIdOrKey: issueKey,
			fields: { [fieldId]: value },
		});
	},

	async getMyself() {
		logger.debug('Fetching authenticated JIRA user');
		return getClient().myself.getCurrentUser();
	},

	async getCloudId(): Promise<string> {
		if (cachedCloudId) return cachedCloudId;
		const creds = getJiraCredentials();
		const response = await fetch(`${creds.baseUrl}/_edge/tenant_info`, {
			headers: {
				Authorization: `Basic ${Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64')}`,
			},
		});
		if (!response.ok) {
			throw new Error(`Failed to fetch JIRA cloud ID: ${response.status}`);
		}
		const data = (await response.json()) as { cloudId?: string };
		if (!data.cloudId) {
			throw new Error('JIRA tenant_info response missing cloudId');
		}
		cachedCloudId = data.cloudId;
		return cachedCloudId;
	},

	async addCommentReaction(issueId: string, commentId: string, emojiId: string): Promise<void> {
		logger.debug('Adding reaction to JIRA comment', { issueId, commentId, emojiId });
		const creds = getJiraCredentials();
		const cloudId = await jiraClient.getCloudId();
		const ari = `ari%3Acloud%3Ajira%3A${cloudId}%3Acomment%2F${issueId}%2F${commentId}`;
		const response = await fetch(
			`${creds.baseUrl}/rest/reactions/1.0/reactions/${ari}/${emojiId}`,
			{
				method: 'PUT',
				headers: {
					Authorization: `Basic ${Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64')}`,
					'Content-Type': 'application/json',
				},
			},
		);
		if (!response.ok) {
			throw new Error(`Failed to add JIRA comment reaction: ${response.status}`);
		}
	},

	async deleteIssue(issueKey: string) {
		logger.debug('Deleting JIRA issue', { issueKey });
		await getClient().issues.deleteIssue({ issueIdOrKey: issueKey });
	},

	async addAttachmentFile(issueKey: string, buffer: Buffer, filename: string) {
		logger.debug('Adding JIRA attachment', { issueKey, filename });
		await getClient().issueAttachments.addAttachment({
			issueIdOrKey: issueKey,
			attachment: {
				filename,
				file: buffer,
			},
		});
	},

	async addRemoteLink(issueKey: string, url: string, title: string): Promise<void> {
		logger.debug('Adding JIRA remote link', { issueKey, url, title });
		await getClient().issueRemoteLinks.createOrUpdateRemoteIssueLink({
			issueIdOrKey: issueKey,
			globalId: url,
			relationship: 'Pull Request',
			object: {
				url,
				title,
				icon: {
					url16x16: 'https://github.com/favicon.ico',
					title: 'GitHub',
				},
			},
		});
	},

	async createCustomField(name: string, type: string): Promise<{ id: string; name: string }> {
		logger.debug('Creating JIRA custom field', { name, type });
		try {
			const result = await getClient().issueFields.createCustomField({
				name,
				type,
			});
			return {
				id: (result as { id?: string }).id ?? '',
				name: (result as { name?: string }).name ?? '',
			};
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			const detail =
				error instanceof Object && 'response' in error
					? (error as { response?: { data?: unknown } }).response?.data
					: undefined;
			const detailStr = detail ? ` — JIRA response: ${JSON.stringify(detail)}` : '';

			logger.error('JIRA createCustomField failed', { name, type, detail });

			throw new Error(`JIRA createCustomField requires admin permissions: ${message}${detailStr}`);
		}
	},
};
