import { INITIAL_MESSAGES } from '../../config/agentMessages.js';
import { loadProjectConfigByRepo } from '../../config/provider.js';
import { getSessionState } from '../../gadgets/sessionState.js';
import { githubClient, withGitHubToken } from '../../github/client.js';
import { getPersonaToken, resolvePersonaIdentities } from '../../github/personas.js';
import { withPMCredentials } from '../../pm/context.js';
import { createPMProvider, pmRegistry, withPMProvider } from '../../pm/index.js';
import { extractGitHubContext, generateAckMessage } from '../../router/ackMessageGenerator.js';
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
import { parseRepoFullName } from '../../utils/repo.js';
import { safeOperation } from '../../utils/safeOperation.js';
import type { TriggerRegistry } from '../registry.js';
import type { AgentExecutionConfig } from '../shared/agent-execution.js';
import { runAgentExecutionPipeline } from '../shared/agent-execution.js';
import { processNextQueuedWebhook } from '../shared/webhook-queue.js';
import type { TriggerResult } from '../types.js';

async function deleteProgressCommentOnSuccess(result: TriggerResult): Promise<void> {
	// Only delete the progress comment for non-implementation agents.
	// The implementation agent's success is handled via lifecycle (handleSuccess),
	// which manages the PR comment separately.
	if (result.agentType === 'implementation') return;

	const input = result.agentInput as { repoFullName?: string };
	if (!input.repoFullName || !result.prNumber) return;

	let owner: string;
	let repo: string;
	try {
		({ owner, repo } = parseRepoFullName(input.repoFullName));
	} catch {
		return;
	}

	const { initialCommentId } = getSessionState();
	if (!initialCommentId) return;

	await safeOperation(() => githubClient.deletePRComment(owner, repo, initialCommentId), {
		action: 'delete progress comment after agent success',
		prNumber: result.prNumber,
	});
}

async function updateInitialCommentWithError(
	result: TriggerResult,
	agentResult: { success: boolean; error?: string },
): Promise<void> {
	const input = result.agentInput as { repoFullName?: string };
	if (!input.repoFullName || !result.prNumber) return;

	let owner: string;
	let repo: string;
	try {
		({ owner, repo } = parseRepoFullName(input.repoFullName));
	} catch {
		return;
	}

	const { initialCommentId } = getSessionState();
	if (!initialCommentId) return;

	const errorMessage = agentResult.error || 'Agent completed without making changes';
	const body = `⚠️ **${result.agentType} agent failed**\n\n${errorMessage}\n\n<sub>Manual intervention may be required.</sub>`;

	await safeOperation(() => githubClient.updatePRComment(owner, repo, initialCommentId, body), {
		action: 'update PR comment with error',
		prNumber: result.prNumber,
	});
}

async function postAcknowledgmentComment(
	result: TriggerResult,
	payload: unknown,
	eventType: string,
): Promise<void> {
	if (!result.agentType || !result.prNumber) {
		return;
	}
	const input = result.agentInput as {
		repoFullName?: string;
		project?: ProjectConfig;
	};
	if (!input.repoFullName) {
		return;
	}
	const { owner, repo } = parseRepoFullName(input.repoFullName);
	const prNumber = result.prNumber;

	// Generate LLM ack message, falling back to static INITIAL_MESSAGES
	let message: string;
	try {
		const context = extractGitHubContext(payload, eventType);
		const projectId = input.project?.id;
		message = projectId
			? await generateAckMessage(result.agentType, context, projectId)
			: (INITIAL_MESSAGES[result.agentType] ?? INITIAL_MESSAGES.implementation);
	} catch {
		message = INITIAL_MESSAGES[result.agentType] ?? INITIAL_MESSAGES.implementation;
	}

	const comment = await safeOperation(
		() => githubClient.createPRComment(owner, repo, prNumber, message),
		{ action: 'post acknowledgment comment', prNumber },
	);
	if (comment) {
		result.agentInput.ackCommentId = comment.id;
		result.agentInput.ackMessage = message;
	}
}

async function executeGitHubAgent(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	if (!result.agentType) return;
	const githubToken = await getPersonaToken(project.id, result.agentType);
	const restoreLlmEnv = await injectLlmApiKeys(project.id);

	const executionConfig: AgentExecutionConfig = {
		skipPrepareForAgent: true,
		skipHandleFailure: true,
		handleSuccessOnlyForAgentType: 'implementation',
		onSuccess: deleteProgressCommentOnSuccess,
		onFailure: updateInitialCommentWithError,
		logLabel: 'GitHub agent',
	};

	try {
		const pmProvider = createPMProvider(project);
		await withPMCredentials(
			project.id,
			project.pm?.type,
			(t) => pmRegistry.getOrNull(t),
			() =>
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
	eventType: string,
	routerAckCommentId?: number,
	routerAckMessage?: string,
): Promise<void> {
	if (!result.agentType) return;
	// Use the persona token for the agent that will do the work (for ack comments)
	let prCommentToken: string;
	try {
		prCommentToken = await getPersonaToken(project.id, result.agentType);
	} catch {
		prCommentToken = githubToken;
	}

	// Skip worker-side ack if the router already posted one; otherwise generate one for all agents
	if (routerAckCommentId) {
		// Router already posted — just propagate the message text
		if (routerAckMessage) {
			result.agentInput.ackMessage = routerAckMessage;
		}
	} else {
		await withGitHubToken(prCommentToken, async () => {
			await postAcknowledgmentComment(result, payload, eventType);
		});
	}
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
		(payload, eventType, ackCommentId, ackMsg) =>
			processGitHubWebhook(
				payload,
				eventType ?? 'pull_request_review_comment',
				registry,
				ackCommentId as number | undefined,
				ackMsg,
			),
		'GitHub',
		(entry) => entry.eventType ?? 'pull_request_review_comment',
	);
}

/**
 * Poll until all CI checks pass before starting the agent.
 * Returns false if checks don't pass after polling (agent should be skipped).
 */
async function pollWaitForChecks(
	result: TriggerResult,
	repoFullName: string,
	githubToken: string,
): Promise<boolean> {
	const { waitForChecks } = await import('./check-suite-success.js');
	const { owner, repo } = parseRepoFullName(repoFullName);
	const headSha = result.agentInput.headSha as string;
	const prNumber = result.prNumber ?? 0;

	logger.info('Waiting for all checks to pass before starting agent', { prNumber, headSha });

	const checkStatus = await withGitHubToken(githubToken, () =>
		waitForChecks(owner, repo, headSha, prNumber),
	);

	if (!checkStatus.allPassing) {
		logger.info('Not all checks passing after polling, skipping agent', {
			prNumber,
			headSha,
			failedChecks: checkStatus.checkRuns
				.filter((c) => c.conclusion !== 'success')
				.map((c) => c.name),
		});
		return false;
	}

	logger.info('All checks passing, proceeding with agent', { prNumber });
	return true;
}

/** Try to enqueue the webhook if another job is already processing. Returns true if enqueued (caller should return). */
function tryEnqueueIfBusy(
	payload: unknown,
	eventType: string,
	ackCommentId?: number,
	ackMessage?: string,
): boolean {
	if (!isCurrentlyProcessing()) return false;

	const queued = enqueueWebhook(payload, eventType, ackCommentId, ackMessage);
	if (queued) {
		logger.info('Currently processing, GitHub webhook queued', {
			queueLength: getQueueLength(),
			eventType,
		});
	} else {
		logger.warn('Queue full, GitHub webhook rejected', { queueLength: getQueueLength() });
	}
	return true;
}

/** Resolve trigger result — use pre-resolved from router or dispatch via registry. */
async function resolveTriggerResult(
	existing: TriggerResult | undefined,
	project: ProjectConfig,
	payload: unknown,
	personaIdentities: Awaited<ReturnType<typeof resolvePersonaIdentities>>,
	githubToken: string,
	registry: TriggerRegistry,
): Promise<TriggerResult | null> {
	if (existing) {
		logger.info('Using pre-resolved trigger result for GitHub webhook', {
			agentType: existing.agentType,
		});
		return existing;
	}

	const ctx: TriggerContext = { project, source: 'github', payload, personaIdentities };
	const pmProvider = createPMProvider(project);
	return withPMCredentials(
		project.id,
		project.pm?.type,
		(t) => pmRegistry.getOrNull(t),
		() =>
			withPMProvider(pmProvider, () => withGitHubToken(githubToken, () => registry.dispatch(ctx))),
	);
}

export async function processGitHubWebhook(
	payload: unknown,
	eventType: string,
	registry: TriggerRegistry,
	ackCommentId?: number,
	ackMessage?: string,
	triggerResult?: TriggerResult,
): Promise<void> {
	logger.info('Processing GitHub webhook', { eventType, hasTriggerResult: !!triggerResult });

	const p = payload as Record<string, unknown>;
	const repository = p.repository as Record<string, unknown> | undefined;
	const repoFullName = repository?.full_name as string | undefined;

	if (!repoFullName) {
		logger.warn('GitHub webhook missing repository info');
		return;
	}

	if (tryEnqueueIfBusy(payload, eventType, ackCommentId, ackMessage)) return;

	const projectConfig = await loadProjectConfigByRepo(repoFullName);
	if (!projectConfig) {
		logger.warn('No project configured for repository', { repoFullName });
		return;
	}
	const { project, config } = projectConfig;

	const personaIdentities = await resolvePersonaIdentities(project.id);
	const githubToken = await getPersonaToken(project.id, 'implementation');

	const result = await resolveTriggerResult(
		triggerResult,
		project,
		payload,
		personaIdentities,
		githubToken,
		registry,
	);

	if (!result) {
		logger.info('No trigger matched for GitHub webhook', { eventType, repoFullName });
		return;
	}

	// Pass ack comment ID + message into agent input for ProgressMonitor pre-seeding
	if (ackCommentId) {
		result.agentInput.ackCommentId = ackCommentId;
	}
	if (ackMessage) {
		result.agentInput.ackMessage = ackMessage;
	}

	// Poll until all CI checks pass before starting agent (deferred from trigger)
	if (result.waitForChecks) {
		const checksOk = await pollWaitForChecks(result, repoFullName, githubToken);
		if (!checksOk) return;
	}

	logger.info('GitHub trigger matched', {
		agentType: result.agentType || '(no agent)',
		prNumber: result.prNumber,
	});

	if (result.agentType) {
		await runGitHubAgentJob(
			result,
			project,
			config,
			githubToken,
			registry,
			payload,
			eventType,
			ackCommentId,
			ackMessage,
		);
	} else {
		logger.info('Trigger completed without agent', { prNumber: result.prNumber });
	}
}
