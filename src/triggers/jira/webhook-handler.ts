/**
 * JIRA webhook handler.
 *
 * Processes JIRA webhooks: validates payload, extracts project key,
 * finds project via findProjectByJiraProjectKey(), resolves creds,
 * and dispatches to the trigger registry.
 */

import {
	getIntegrationCredential,
	loadProjectConfigByJiraProjectKey,
} from '../../config/provider.js';
import { withGitHubToken } from '../../github/client.js';
import { getPersonaToken } from '../../github/personas.js';
import { withJiraCredentials } from '../../jira/client.js';
import {
	PMLifecycleManager,
	createPMProvider,
	resolveProjectPMConfig,
	withPMProvider,
} from '../../pm/index.js';
import type { CascadeConfig, ProjectConfig, TriggerContext } from '../../types/index.js';
import {
	enqueueWebhook,
	getQueueLength,
	isCurrentlyProcessing,
	logger,
	setProcessing,
	startWatchdog,
} from '../../utils/index.js';
import { injectLlmApiKeys } from '../../utils/llmEnv.js';
import type { TriggerRegistry } from '../registry.js';
import { runAgentExecutionPipeline } from '../shared/agent-execution.js';
import { processNextQueuedWebhook } from '../shared/webhook-queue.js';
import type { TriggerResult } from '../types.js';

interface JiraWebhookPayload {
	webhookEvent: string;
	issue?: {
		id?: string;
		key: string;
		fields?: {
			project?: { key?: string };
			status?: { name?: string };
			summary?: string;
			comment?: { comments?: unknown[] };
		};
	};
	comment?: {
		id?: string;
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
	const jiraEmail = await getIntegrationCredential(project.id, 'pm', 'email');
	const jiraApiToken = await getIntegrationCredential(project.id, 'pm', 'api_token');
	const jiraBaseUrl = project.jira?.baseUrl ?? '';
	const githubToken = await getPersonaToken(project.id, result.agentType);

	const restoreLlmEnv = await injectLlmApiKeys(project.id);

	try {
		const pmProvider = createPMProvider(project);
		await withJiraCredentials(
			{ email: jiraEmail, apiToken: jiraApiToken, baseUrl: jiraBaseUrl },
			() =>
				withPMProvider(pmProvider, () =>
					withGitHubToken(githubToken, () =>
						runAgentExecutionPipeline(result, project, config, { logLabel: 'JIRA agent' }),
					),
				),
		);
	} finally {
		restoreLlmEnv();
	}
}

async function handleMatchedJiraTrigger(
	registry: TriggerRegistry,
	payload: JiraWebhookPayload,
	project: ProjectConfig,
	config: CascadeConfig,
	pmProvider: ReturnType<typeof createPMProvider>,
	ackCommentId?: string,
): Promise<void> {
	const ctx: TriggerContext = { project, source: 'jira', payload };
	const result = await registry.dispatch(ctx);
	if (!result) {
		logger.info('No trigger matched for JIRA webhook', { event: payload.webhookEvent });
		if (ackCommentId && payload.issue?.key) {
			await cleanupOrphanJiraAck(project.id, payload.issue.key, ackCommentId);
		}
		return;
	}

	// Pass ack comment ID into agent input for ProgressMonitor pre-seeding
	if (ackCommentId) {
		result.agentInput.ackCommentId = ackCommentId;
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
}

async function cleanupOrphanJiraAck(
	projectId: string,
	issueKey: string,
	ackCommentId: string,
): Promise<void> {
	logger.info('Cleaning up orphan ack comment', { ackCommentId, issueKey });
	const { deleteJiraAck } = await import('../../router/acknowledgments.js');
	await deleteJiraAck(projectId, issueKey, ackCommentId).catch(() => {});
}

function processNextQueuedJiraWebhook(registry: TriggerRegistry): void {
	processNextQueuedWebhook(
		(payload, _eventType, ackCommentId) =>
			processJiraWebhook(payload, registry, ackCommentId as string | undefined),
		'JIRA',
	);
}

export async function processJiraWebhook(
	payload: unknown,
	registry: TriggerRegistry,
	ackCommentId?: string,
): Promise<void> {
	logger.info('Processing JIRA webhook');

	if (!isJiraWebhookPayload(payload)) {
		logger.warn('Invalid JIRA webhook payload', {
			payload: JSON.stringify(payload).slice(0, 200),
		});
		return;
	}

	if (isCurrentlyProcessing()) {
		const queued = enqueueWebhook(payload, undefined, ackCommentId);
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

	const projectConfig = await loadProjectConfigByJiraProjectKey(projectKey);
	if (!projectConfig) {
		logger.warn('No project configured for JIRA project key', { projectKey });
		return;
	}
	const { project, config } = projectConfig;

	// Establish JIRA credential + PM provider scope
	const jiraEmail = await getIntegrationCredential(project.id, 'pm', 'email');
	const jiraApiToken = await getIntegrationCredential(project.id, 'pm', 'api_token');
	const jiraBaseUrl = project.jira?.baseUrl ?? '';
	const pmProvider = createPMProvider(project);

	await withJiraCredentials(
		{ email: jiraEmail, apiToken: jiraApiToken, baseUrl: jiraBaseUrl },
		() =>
			withPMProvider(pmProvider, () =>
				handleMatchedJiraTrigger(registry, payload, project, config, pmProvider, ackCommentId),
			),
	);
}
