/**
 * JIRA webhook handler.
 *
 * Processes JIRA webhooks: validates payload, extracts project key,
 * finds project via findProjectByJiraProjectKey(), resolves creds,
 * and dispatches to the trigger registry.
 */

import { runAgent } from '../../agents/registry.js';
import { getProjectSecret, loadProjectConfigByJiraProjectKey } from '../../config/provider.js';
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
	dequeueWebhook,
	enqueueWebhook,
	getQueueLength,
	isCurrentlyProcessing,
	logger,
	setProcessing,
	startWatchdog,
} from '../../utils/index.js';
import { injectLlmApiKeys } from '../../utils/llmEnv.js';
import type { TriggerRegistry } from '../registry.js';
import { handleAgentResultArtifacts } from '../shared/agent-result-handler.js';
import { checkBudgetExceeded } from '../shared/budget.js';
import { triggerDebugAnalysis } from '../shared/debug-runner.js';
import { shouldTriggerDebug } from '../shared/debug-trigger.js';
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
	const jiraEmail = await getProjectSecret(project.id, 'JIRA_EMAIL');
	const jiraApiToken = await getProjectSecret(project.id, 'JIRA_API_TOKEN');
	const jiraBaseUrl =
		project.jira?.baseUrl ?? (await getProjectSecret(project.id, 'JIRA_BASE_URL'));
	const githubToken = await getPersonaToken(project.id, result.agentType);

	const restoreLlmEnv = await injectLlmApiKeys(project.id);

	try {
		const pmProvider = createPMProvider(project);
		await withJiraCredentials(
			{ email: jiraEmail, apiToken: jiraApiToken, baseUrl: jiraBaseUrl },
			() =>
				withPMProvider(pmProvider, () =>
					withGitHubToken(githubToken, () => executeJiraAgentWithCreds(result, project, config)),
				),
		);
	} finally {
		restoreLlmEnv();
	}
}

async function executeJiraAgentWithCreds(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	const workItemId = result.workItemId ?? result.cardId;
	const pmProvider = createPMProvider(project);
	const pmConfig = resolveProjectPMConfig(project);
	const lifecycle = new PMLifecycleManager(pmProvider, pmConfig);

	let remainingBudgetUsd: number | undefined;
	if (workItemId) {
		const budgetCheck = await checkBudgetExceeded(workItemId, project, config);
		if (budgetCheck?.exceeded) {
			logger.warn('Budget exceeded, JIRA agent not started', {
				workItemId,
				currentCost: budgetCheck.currentCost,
				budget: budgetCheck.budget,
			});
			await lifecycle.handleBudgetExceeded(workItemId, budgetCheck.currentCost, budgetCheck.budget);
			return;
		}
		remainingBudgetUsd = budgetCheck?.remaining;
	}

	if (workItemId) {
		await lifecycle.prepareForAgent(workItemId, result.agentType);
	}

	const agentResult = await runAgent(result.agentType, {
		...result.agentInput,
		cardId: workItemId,
		remainingBudgetUsd,
		project,
		config,
	});

	if (workItemId) {
		await handleAgentResultArtifacts(workItemId, result.agentType, agentResult, project);

		const postBudgetCheck = await checkBudgetExceeded(workItemId, project, config);
		if (postBudgetCheck?.exceeded) {
			await lifecycle.handleBudgetWarning(
				workItemId,
				postBudgetCheck.currentCost,
				postBudgetCheck.budget,
			);
		}

		await lifecycle.cleanupProcessing(workItemId);

		if (agentResult.success) {
			await lifecycle.handleSuccess(workItemId, result.agentType, agentResult.prUrl);
		} else {
			await lifecycle.handleFailure(workItemId, agentResult.error);
		}
	}

	logger.info('JIRA agent completed', {
		agentType: result.agentType,
		success: agentResult.success,
		runId: agentResult.runId,
	});

	// Auto-debug
	if (agentResult.runId) {
		const debugTarget = await shouldTriggerDebug(agentResult.runId);
		if (debugTarget) {
			triggerDebugAnalysis(debugTarget.runId, project, config, debugTarget.cardId).catch((err) =>
				logger.error('Auto-debug failed', { error: String(err) }),
			);
		}
	}
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

	const projectConfig = await loadProjectConfigByJiraProjectKey(projectKey);
	if (!projectConfig) {
		logger.warn('No project configured for JIRA project key', { projectKey });
		return;
	}
	const { project, config } = projectConfig;

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
