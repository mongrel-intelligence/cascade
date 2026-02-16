/**
 * JIRA webhook handler.
 *
 * Processes JIRA webhooks: validates payload, extracts project key,
 * finds project via findProjectByJiraProjectKey(), resolves creds,
 * and dispatches to the trigger registry.
 */

import {
	findProjectByJiraProjectKey,
	getProjectSecret,
	loadConfig,
} from '../../config/provider.js';
import { withJiraCredentials } from '../../jira/client.js';
import {
	PMLifecycleManager,
	createPMProvider,
	resolveProjectPMConfig,
	withPMProvider,
} from '../../pm/index.js';
import type { CascadeConfig, ProjectConfig, TriggerContext } from '../../types/index.js';
import {
	dequeueWebhook,
	enqueueWebhook,
	getQueueLength,
	isCurrentlyProcessing,
	logger,
	setProcessing,
	startWatchdog,
} from '../../utils/index.js';
import type { TriggerRegistry } from '../registry.js';
import { executeAgentPipeline } from '../shared/agent-pipeline.js';
import { withProjectCredentials } from '../shared/credential-scope.js';
import type { TriggerResult } from '../types.js';

interface JiraWebhookPayload {
	webhookEvent: string;
	issue?: {
		key: string;
		fields?: {
			project?: { key?: string };
			status?: { name?: string };
			summary?: string;
			comment?: { comments?: unknown[] };
		};
	};
	comment?: {
		body?: unknown;
		author?: { displayName?: string; accountId?: string };
	};
	changelog?: {
		items?: Array<{
			field?: string;
			fromString?: string;
			toString?: string;
		}>;
	};
}

function isJiraWebhookPayload(payload: unknown): payload is JiraWebhookPayload {
	const p = payload as Record<string, unknown>;
	return typeof p?.webhookEvent === 'string';
}

function extractProjectKey(payload: JiraWebhookPayload): string | undefined {
	return payload.issue?.fields?.project?.key;
}

async function executeJiraAgent(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	await withProjectCredentials(project, result.agentType, () =>
		executeAgentPipeline({ result, project, config }),
	);
}

function processNextQueuedJiraWebhook(registry: TriggerRegistry): void {
	const next = dequeueWebhook();
	if (next) {
		logger.info('Processing queued JIRA webhook', { queueLength: getQueueLength() });
		setImmediate(() => {
			processJiraWebhook(next.payload, registry).catch((err) => {
				logger.error('Failed to process queued JIRA webhook', { error: String(err) });
			});
		});
	}
}

export async function processJiraWebhook(
	payload: unknown,
	registry: TriggerRegistry,
): Promise<void> {
	logger.info('Processing JIRA webhook');

	if (!isJiraWebhookPayload(payload)) {
		logger.warn('Invalid JIRA webhook payload', {
			payload: JSON.stringify(payload).slice(0, 200),
		});
		return;
	}

	if (isCurrentlyProcessing()) {
		const queued = enqueueWebhook(payload);
		if (queued) {
			logger.info('Currently processing, JIRA webhook queued', { queueLength: getQueueLength() });
		} else {
			logger.warn('Queue full, JIRA webhook rejected', { queueLength: getQueueLength() });
		}
		return;
	}

	const projectKey = extractProjectKey(payload);
	if (!projectKey) {
		logger.warn('JIRA webhook missing project key');
		return;
	}

	logger.info('JIRA webhook details', {
		event: payload.webhookEvent,
		issueKey: payload.issue?.key,
		projectKey,
	});

	const config = await loadConfig();

	const project = await findProjectByJiraProjectKey(projectKey);
	if (!project) {
		logger.warn('No project configured for JIRA project key', { projectKey });
		return;
	}

	// Establish JIRA credential + PM provider scope
	const jiraEmail = await getProjectSecret(project.id, 'JIRA_EMAIL');
	const jiraApiToken = await getProjectSecret(project.id, 'JIRA_API_TOKEN');
	const jiraBaseUrl =
		project.jira?.baseUrl ?? (await getProjectSecret(project.id, 'JIRA_BASE_URL'));
	const pmProvider = createPMProvider(project);

	await withJiraCredentials(
		{ email: jiraEmail, apiToken: jiraApiToken, baseUrl: jiraBaseUrl },
		() =>
			withPMProvider(pmProvider, async () => {
				const ctx: TriggerContext = { project, source: 'jira', payload };
				const result = await registry.dispatch(ctx);
				if (!result) {
					logger.info('No trigger matched for JIRA webhook', { event: payload.webhookEvent });
					return;
				}

				logger.info('JIRA trigger matched', {
					agentType: result.agentType,
					workItemId: result.workItemId,
				});

				setProcessing(true);
				startWatchdog(config.defaults.watchdogTimeoutMs);

				const pmConfig = resolveProjectPMConfig(project);
				const lifecycle = new PMLifecycleManager(pmProvider, pmConfig);

				try {
					await executeJiraAgent(result, project, config);
				} catch (err) {
					logger.error('Failed to process JIRA webhook', { error: String(err) });
					if (result.workItemId) {
						await lifecycle.handleError(result.workItemId, String(err));
					}
				} finally {
					setProcessing(false);
					processNextQueuedJiraWebhook(registry);
				}
			}),
	);
}
