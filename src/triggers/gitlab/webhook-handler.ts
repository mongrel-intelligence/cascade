/**
 * GitLab webhook handler.
 *
 * Thin orchestrator that delegates to focused modules, mirroring the
 * GitHub webhook handler pattern:
 * - Ack comment management -> ./ack-comments.ts
 * - Credential scoping + agent execution -> ../shared/webhook-execution.ts
 * - GitLab-specific AgentExecutionConfig -> ./integration.ts
 * - Agent-type concurrency -> ../shared/concurrency.ts
 * - PM credential scope -> ../shared/credential-scope.ts
 * - PM ack posting -> ../shared/pm-ack.ts
 */

import { isPMFocusedAgent } from '../../agents/definitions/loader.js';
import { withGitLabToken } from '../../gitlab/client.js';
import { getPersonaToken, resolvePersonaIdentities } from '../../gitlab/personas.js';
import type { CascadeConfig, ProjectConfig, TriggerContext } from '../../types/index.js';
import { logger, startWatchdog } from '../../utils/index.js';
import type { TriggerRegistry } from '../registry.js';
import { withAgentTypeConcurrency } from '../shared/concurrency.js';
import { withPMScope } from '../shared/credential-scope.js';
import { postPMAckComment } from '../shared/pm-ack.js';
import { runAgentWithCredentials } from '../shared/webhook-execution.js';
import type { TriggerResult } from '../types.js';
import { GitLabWebhookIntegration } from './integration.js';

const integration = new GitLabWebhookIntegration();

function requireProjectId(project: ProjectConfig): string {
	if (!project.id) {
		throw new Error('Project id is required for GitLab webhook processing');
	}
	return project.id;
}

/** Dispatch to trigger registry within PM credential + provider scope. */
async function dispatchTrigger(
	registry: TriggerRegistry,
	payload: unknown,
	project: ProjectConfig,
): Promise<TriggerResult | null> {
	const projectId = requireProjectId(project);
	const personaIdentities = await resolvePersonaIdentities(projectId);
	const gitlabToken = await getPersonaToken(projectId, 'implementation');
	const ctx: TriggerContext = { project, source: 'gitlab', payload, personaIdentities };
	return withPMScope(project, () => withGitLabToken(gitlabToken, () => registry.dispatch(ctx)));
}

/** Post ack comment on PM card for PM-focused agents. */
async function maybePostPmAckComment(
	result: TriggerResult,
	project: ProjectConfig,
	workItemId: string,
): Promise<void> {
	const projectId = requireProjectId(project);
	const pmType = project.pm?.type;
	const message = `GitLab ${result.agentType ?? 'agent'} triggered`;

	const commentId = await postPMAckComment(
		projectId,
		workItemId,
		pmType,
		message,
		result.agentType ?? undefined,
	);

	if (commentId) {
		result.agentInput.ackCommentId = commentId;
		result.agentInput.ackMessage = message;
	}
}

function resolveGitLabExecutionConfig(pmFocused: boolean) {
	if (!pmFocused) {
		return integration.resolveExecutionConfig();
	}

	return {
		skipPrepareForAgent: false,
		skipHandleFailure: false,
		logLabel: 'GitLab (PM-focused agent)',
	};
}

/** Run the agent with GitLab-specific (or PM-appropriate) execution config. */
async function runGitLabAgent(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
): Promise<void> {
	const pmFocused = result.agentType ? await isPMFocusedAgent(result.agentType) : false;
	const agentType = result.agentType;

	const execute = async () => {
		startWatchdog(project.watchdogTimeoutMs);
		const projectId = requireProjectId(project);
		const gitlabToken = await getPersonaToken(projectId, agentType ?? 'implementation');

		await withPMScope(project, () =>
			withGitLabToken(gitlabToken, () =>
				runAgentWithCredentials(
					integration,
					result,
					project,
					config,
					resolveGitLabExecutionConfig(pmFocused),
				),
			),
		);
	};

	try {
		if (agentType) {
			await withAgentTypeConcurrency(project.id, agentType, execute, 'GitLab agent');
		} else {
			await execute();
		}
	} catch (err) {
		logger.error('Failed to process GitLab webhook', { error: String(err) });
	}
}

/** Post PM ack comment if the agent is PM-focused and has a work item. */
async function maybePostPmAck(result: TriggerResult, project: ProjectConfig): Promise<void> {
	if (!result.agentType) return;
	if (!(await isPMFocusedAgent(result.agentType))) return;

	const workItemId = result.workItemId;
	if (!workItemId) return;

	try {
		await maybePostPmAckComment(result, project, workItemId);
	} catch (err) {
		logger.warn('PM ack comment failed for PM-focused agent (non-fatal)', {
			error: String(err),
			agentType: result.agentType,
		});
	}
}

/** Resolve the trigger result from either a pre-resolved value or the registry. */
async function resolveTriggerResult(
	registry: TriggerRegistry,
	payload: unknown,
	project: ProjectConfig,
	triggerResult: TriggerResult | undefined,
): Promise<TriggerResult | null> {
	if (triggerResult) {
		logger.info('Using pre-resolved trigger result for GitLab webhook', {
			agentType: triggerResult.agentType,
		});
		return triggerResult;
	}
	return dispatchTrigger(registry, payload, project);
}

export async function processGitLabWebhook(
	payload: unknown,
	eventType: string,
	registry: TriggerRegistry,
	ackCommentId?: number,
	ackMessage?: string,
	triggerResult?: TriggerResult,
): Promise<void> {
	logger.info('Processing GitLab webhook', { eventType, hasTriggerResult: !!triggerResult });

	const event = integration.parseWebhookPayload(payload);
	if (!event) {
		logger.warn('GitLab webhook missing project info');
		return;
	}

	const projectConfig = await integration.lookupProject(event.projectIdentifier);
	if (!projectConfig) {
		logger.warn('No project configured for repository', {
			pathWithNamespace: event.projectIdentifier,
		});
		return;
	}
	const { project, config } = projectConfig;

	const result = await resolveTriggerResult(registry, payload, project, triggerResult);

	if (!result) {
		logger.info('No trigger matched for GitLab webhook', {
			eventType,
			pathWithNamespace: event.projectIdentifier,
		});
		return;
	}

	// Inject ack comment info from router into agent input
	if (ackCommentId) result.agentInput.ackCommentId = ackCommentId;
	if (ackMessage) result.agentInput.ackMessage = ackMessage;

	logger.info('GitLab trigger matched', {
		agentType: result.agentType || '(no agent)',
		mrIid: result.prNumber,
	});

	if (!result.agentType) {
		logger.info('Trigger completed without agent', { mrIid: result.prNumber });
		return;
	}

	await maybePostPmAck(result, project);
	await runGitLabAgent(result, project, config);
}
