import { runAgent } from '../../agents/registry.js';
import {
	findProjectByRepo,
	getAgentCredential,
	getProjectSecret,
	loadConfig,
} from '../../config/provider.js';
import { getSessionState } from '../../gadgets/sessionState.js';
import { githubClient, withGitHubToken } from '../../github/client.js';
import {
	PMLifecycleManager,
	createPMProvider,
	resolveProjectPMConfig,
	withPMProvider,
} from '../../pm/index.js';
import { withTrelloCredentials } from '../../trello/client.js';
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
import { safeOperation } from '../../utils/safeOperation.js';
import type { TriggerRegistry } from '../registry.js';
import { handleAgentResultArtifacts } from '../shared/agent-result-handler.js';
import { checkBudgetExceeded } from '../shared/budget.js';
import { triggerDebugAnalysis } from '../shared/debug-runner.js';
import { shouldTriggerDebug } from '../shared/debug-trigger.js';
import type { TriggerResult } from '../types.js';

async function executeGitHubAgent(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	const trelloApiKey = await getProjectSecret(project.id, 'TRELLO_API_KEY').catch(() => '');
	const trelloToken = await getProjectSecret(project.id, 'TRELLO_TOKEN').catch(() => '');
	const agentGitHubToken = await getAgentCredential(project.id, result.agentType, 'GITHUB_TOKEN');
	const githubToken = agentGitHubToken || (await getProjectSecret(project.id, 'GITHUB_TOKEN'));

	const restoreLlmEnv = await injectLlmApiKeys(project.id);

	try {
		const pmProvider = createPMProvider(project);
		await withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, () =>
			withPMProvider(pmProvider, () =>
				withGitHubToken(githubToken, () => executeGitHubAgentWithCreds(result, project, config)),
			),
		);
	} finally {
		restoreLlmEnv();
	}
}

async function executeGitHubAgentWithCreds(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	const cardId = result.cardId ?? result.workItemId;
	const pmProvider = createPMProvider(project);
	const pmConfig = resolveProjectPMConfig(project);
	const lifecycle = new PMLifecycleManager(pmProvider, pmConfig);

	let remainingBudgetUsd: number | undefined;
	if (cardId) {
		const budgetCheck = await checkBudgetExceeded(cardId, project, config);
		if (budgetCheck?.exceeded) {
			logger.warn('Budget exceeded, GitHub agent not started', {
				cardId,
				currentCost: budgetCheck.currentCost,
				budget: budgetCheck.budget,
			});
			await lifecycle.handleBudgetExceeded(cardId, budgetCheck.currentCost, budgetCheck.budget);
			return;
		}
		remainingBudgetUsd = budgetCheck?.remaining;
	}

	const agentResult = await runAgent(result.agentType, {
		...result.agentInput,
		remainingBudgetUsd,
		project,
		config,
	});

	if (cardId) {
		await handleAgentResultArtifacts(cardId, result.agentType, agentResult, project);

		const postBudgetCheck = await checkBudgetExceeded(cardId, project, config);
		if (postBudgetCheck?.exceeded) {
			await lifecycle.handleBudgetWarning(
				cardId,
				postBudgetCheck.currentCost,
				postBudgetCheck.budget,
			);
		}
	}

	// Move to in-review if implementation completed successfully
	if (cardId && result.agentType === 'implementation' && agentResult.success) {
		await lifecycle.handleSuccess(cardId, result.agentType, agentResult.prUrl);
	}

	if (!agentResult.success && result.prNumber) {
		await updateInitialCommentWithError(result, agentResult);
	}

	logger.info('GitHub agent completed', {
		agentType: result.agentType,
		prNumber: result.prNumber,
		success: agentResult.success,
		cost: agentResult.cost,
		runId: agentResult.runId,
	});

	await tryGitHubAutoDebug(agentResult, project, config);
}

async function tryGitHubAutoDebug(
	agentResult: { runId?: string },
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	if (!agentResult.runId) return;
	const debugTarget = await shouldTriggerDebug(agentResult.runId);
	if (debugTarget) {
		triggerDebugAnalysis(debugTarget.runId, project, config, debugTarget.cardId).catch((err) =>
			logger.error('Auto-debug failed', { error: String(err) }),
		);
	}
}

async function updateInitialCommentWithError(
	result: TriggerResult,
	agentResult: { success: boolean; error?: string },
): Promise<void> {
	const input = result.agentInput as { repoFullName?: string };
	if (!input.repoFullName || !result.prNumber) return;

	const [owner, repo] = input.repoFullName.split('/');
	if (!owner || !repo) return;

	const { initialCommentId } = getSessionState();
	if (!initialCommentId) return;

	const errorMessage = agentResult.error || 'Agent completed without making changes';
	const body = `⚠️ **${result.agentType} agent failed**\n\n${errorMessage}\n\n<sub>Manual intervention may be required.</sub>`;

	await safeOperation(() => githubClient.updatePRComment(owner, repo, initialCommentId, body), {
		action: 'update PR comment with error',
		prNumber: result.prNumber,
	});
}

async function postAcknowledgmentComment(result: TriggerResult): Promise<void> {
	if (
		(result.agentType !== 'respond-to-review' && result.agentType !== 'respond-to-pr-comment') ||
		!result.prNumber
	) {
		return;
	}
	const input = result.agentInput as { repoFullName?: string; acknowledgmentCommentId?: number };
	if (!input.repoFullName) {
		return;
	}
	const [owner, repo] = input.repoFullName.split('/');
	const prNumber = result.prNumber;
	const comment = await safeOperation(
		() => githubClient.createPRComment(owner, repo, prNumber, '👀 Checking this out...'),
		{ action: 'post acknowledgment comment', prNumber },
	);
	if (comment) {
		input.acknowledgmentCommentId = comment.id;
	}
}

async function runGitHubAgentJob(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
	githubToken: string,
	registry: TriggerRegistry,
): Promise<void> {
	const agentGitHubToken = result.agentType
		? await getAgentCredential(project.id, result.agentType, 'GITHUB_TOKEN')
		: null;
	const prCommentToken = agentGitHubToken || githubToken;

	await withGitHubToken(prCommentToken, () => postAcknowledgmentComment(result));
	setProcessing(true);
	startWatchdog(config.defaults.watchdogTimeoutMs);

	try {
		await executeGitHubAgent(result, project, config);
	} catch (err) {
		logger.error('Failed to process GitHub webhook', { error: String(err) });
		await withGitHubToken(prCommentToken, () =>
			updateInitialCommentWithError(result, { success: false, error: String(err) }),
		);
	} finally {
		setProcessing(false);
		processNextQueuedGitHubWebhook(registry);
	}
}

function processNextQueuedGitHubWebhook(registry: TriggerRegistry): void {
	const next = dequeueWebhook();
	if (next) {
		const eventType = next.eventType || 'pull_request_review_comment';
		logger.info('Processing queued GitHub webhook', {
			queueLength: getQueueLength(),
			eventType,
		});
		setImmediate(() => {
			processGitHubWebhook(next.payload, eventType, registry).catch((err) => {
				logger.error('Failed to process queued GitHub webhook', { error: String(err) });
			});
		});
	}
}

export async function processGitHubWebhook(
	payload: unknown,
	eventType: string,
	registry: TriggerRegistry,
): Promise<void> {
	logger.info('Processing GitHub webhook', { eventType });

	const p = payload as Record<string, unknown>;
	const repository = p.repository as Record<string, unknown> | undefined;
	const repoFullName = repository?.full_name as string | undefined;

	if (!repoFullName) {
		logger.warn('GitHub webhook missing repository info');
		return;
	}

	if (isCurrentlyProcessing()) {
		const queued = enqueueWebhook(payload, eventType);
		if (queued) {
			logger.info('Currently processing, GitHub webhook queued', {
				queueLength: getQueueLength(),
				eventType,
			});
		} else {
			logger.warn('Queue full, GitHub webhook rejected', { queueLength: getQueueLength() });
		}
		return;
	}

	const config = await loadConfig();

	const project = await findProjectByRepo(repoFullName);

	if (!project) {
		logger.warn('No project configured for repository', { repoFullName });
		return;
	}

	// Resolve credentials early — trigger handlers may call GitHub/Trello APIs
	const trelloApiKey = await getProjectSecret(project.id, 'TRELLO_API_KEY').catch(() => '');
	const trelloToken = await getProjectSecret(project.id, 'TRELLO_TOKEN').catch(() => '');
	const githubToken = await getProjectSecret(project.id, 'GITHUB_TOKEN');
	const pmProvider = createPMProvider(project);

	const ctx: TriggerContext = { project, source: 'github', payload };
	const result = await withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, () =>
		withPMProvider(pmProvider, () => withGitHubToken(githubToken, () => registry.dispatch(ctx))),
	);

	if (!result) {
		logger.info('No trigger matched for GitHub webhook', { eventType, repoFullName });
		return;
	}

	logger.info('GitHub trigger matched', {
		agentType: result.agentType || '(no agent)',
		prNumber: result.prNumber,
	});

	if (result.agentType) {
		await runGitHubAgentJob(result, project, config, githubToken, registry);
	} else {
		logger.info('Trigger completed without agent', { prNumber: result.prNumber });
	}
}
