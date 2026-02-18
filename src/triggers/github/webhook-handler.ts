import { getProjectSecret, loadProjectConfigByRepo } from '../../config/provider.js';
import { getSessionState } from '../../gadgets/sessionState.js';
import { githubClient, withGitHubToken } from '../../github/client.js';
import { getPersonaToken, resolvePersonaIdentities } from '../../github/personas.js';
import { createPMProvider, withPMProvider } from '../../pm/index.js';
import { withTrelloCredentials } from '../../trello/client.js';
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
import { safeOperation } from '../../utils/safeOperation.js';
import type { TriggerRegistry } from '../registry.js';
import { acknowledgeWithReaction } from '../shared/acknowledge-reaction.js';
import type { AgentExecutionConfig } from '../shared/agent-execution.js';
import { runAgentExecutionPipeline } from '../shared/agent-execution.js';
import { processNextQueuedWebhook } from '../shared/webhook-queue.js';
import type { TriggerResult } from '../types.js';

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
	const input = result.agentInput as {
		repoFullName?: string;
		acknowledgmentCommentId?: number;
		commentAuthor?: string;
	};
	if (!input.repoFullName) {
		return;
	}
	const [owner, repo] = input.repoFullName.split('/');
	const prNumber = result.prNumber;
	const message =
		result.agentType === 'respond-to-pr-comment'
			? `💭 Thinking about your comment, @${input.commentAuthor ?? 'you'}...`
			: '👀 Checking this out...';
	const comment = await safeOperation(
		() => githubClient.createPRComment(owner, repo, prNumber, message),
		{ action: 'post acknowledgment comment', prNumber },
	);
	if (comment) {
		input.acknowledgmentCommentId = comment.id;
	}
}

async function executeGitHubAgent(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	const trelloApiKey = await getProjectSecret(project.id, 'TRELLO_API_KEY').catch(() => '');
	const trelloToken = await getProjectSecret(project.id, 'TRELLO_TOKEN').catch(() => '');
	const githubToken = await getPersonaToken(project.id, result.agentType);

	const restoreLlmEnv = await injectLlmApiKeys(project.id);

	const executionConfig: AgentExecutionConfig = {
		skipPrepareForAgent: true,
		skipHandleFailure: true,
		handleSuccessOnlyForAgentType: 'implementation',
		onFailure: updateInitialCommentWithError,
		logLabel: 'GitHub agent',
	};

	try {
		const pmProvider = createPMProvider(project);
		await withTrelloCredentials({ apiKey: trelloApiKey, token: trelloToken }, () =>
			withPMProvider(pmProvider, () =>
				withGitHubToken(githubToken, () =>
					runAgentExecutionPipeline(result, project, config, executionConfig),
				),
			),
		);
	} finally {
		restoreLlmEnv();
	}
}

async function runGitHubAgentJob(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
	githubToken: string,
	registry: TriggerRegistry,
	payload: unknown,
): Promise<void> {
	// Use the persona token for the agent that will do the work (for ack comments)
	let prCommentToken: string;
	try {
		prCommentToken = await getPersonaToken(project.id, result.agentType);
	} catch {
		prCommentToken = githubToken;
	}

	await withGitHubToken(prCommentToken, async () => {
		await acknowledgeWithReaction('github', payload);
		await postAcknowledgmentComment(result);
	});
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
	processNextQueuedWebhook(
		(payload, eventType) =>
			processGitHubWebhook(payload, eventType ?? 'pull_request_review_comment', registry),
		'GitHub',
		(entry) => entry.eventType ?? 'pull_request_review_comment',
	);
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

	const projectConfig = await loadProjectConfigByRepo(repoFullName);
	if (!projectConfig) {
		logger.warn('No project configured for repository', { repoFullName });
		return;
	}
	const { project, config } = projectConfig;

	// Resolve credentials early — trigger handlers may call GitHub/Trello APIs
	const trelloApiKey = await getProjectSecret(project.id, 'TRELLO_API_KEY').catch(() => '');
	const trelloToken = await getProjectSecret(project.id, 'TRELLO_TOKEN').catch(() => '');

	// Resolve persona identities and use implementer token for webhook processing
	const personaIdentities = await resolvePersonaIdentities(project.id);
	const githubToken = await getPersonaToken(project.id, 'implementation');
	const pmProvider = createPMProvider(project);

	const ctx: TriggerContext = { project, source: 'github', payload, personaIdentities };
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
		await runGitHubAgentJob(result, project, config, githubToken, registry, payload);
	} else {
		logger.info('Trigger completed without agent', { prNumber: result.prNumber });
	}
}
