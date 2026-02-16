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

	async addComment(issueKey: string, body: unknown) {
		logger.debug('Adding JIRA comment', { issueKey });
		await getClient().issueComments.addComment({
			issueIdOrKey: issueKey,
			comment: body as any,
		});
	},

	async createIssue(fields: Record<string, unknown>) {
		logger.debug('Creating JIRA issue', { project: (fields.project as any)?.key });
		return getClient().issues.createIssue({ fields: fields as any });
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
};
