import { getAgentProfile } from '../../agents/definitions/profiles.js';
import type { LifecycleHooks } from '../../agents/definitions/schema.js';
import { runAgent } from '../../agents/registry.js';
import { isPmPostingEnabled, resolveUpdateChannel } from '../../config/updateChannel.js';
import { createPMProvider, PMLifecycleManager, resolveProjectPMConfig } from '../../pm/index.js';
import type { AgentResult, CascadeConfig, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import type { TriggerResult } from '../types.js';
import type { AgentExecutionConfig, AgentExecutionContext } from './agent-execution-types.js';
import { postAgentSummaryToPM } from './agent-pm-summary.js';
import {
	linkPRPostExecution,
	persistPreRunWorkItems,
	prepareAgentWorkItem,
	reresolveReviewWorkItemFromFreshPR,
} from './agent-work-items.js';

async function loadLifecycleHooks(agentType: string): Promise<LifecycleHooks> {
	try {
		const agentProfile = await getAgentProfile(agentType);
		return agentProfile.lifecycleHooks;
	} catch (err) {
		logger.warn('Failed to load agent profile for lifecycle hooks, using defaults', {
			agentType,
			error: String(err),
		});
		return {};
	}
}

export async function createAgentExecutionContext(
	result: TriggerResult,
	project: ProjectConfig,
	config: CascadeConfig,
	executionConfig: AgentExecutionConfig,
): Promise<AgentExecutionContext> {
	if (!result.agentType) {
		throw new Error('createAgentExecutionContext requires result.agentType');
	}

	const pmProvider = createPMProvider(project);
	const pmConfig = resolveProjectPMConfig(project);
	// Gate system-driven PM comment posting on the agent's resolved update
	// channel. Status moves, label writes, and linkPR remain unaffected — only
	// the lifecycle's communication comments are suppressed when PM posting is
	// disabled.
	const pmPostingEnabled = isPmPostingEnabled(resolveUpdateChannel(project, result.agentType));
	const lifecycle = new PMLifecycleManager(pmProvider, pmConfig, pmPostingEnabled);
	const lifecycleHooks = await loadLifecycleHooks(result.agentType);
	let { workItemId, agentInput } = await prepareAgentWorkItem(result, project.id);

	// Race fix: dispatch resolves the work item from the webhook PR snapshot. If a
	// human adds the JIRA key to the PR description after requesting review, that
	// snapshot misses it. Re-resolve from live PR state here — before budget /
	// persistence / progress-comment / image pre-fetch consume the work item — so a
	// late-added key still links end-to-end. Deliberately mutates the
	// execution-local `result` so persistPreRunWorkItems records the resolved
	// id + display data on the PR link.
	const reresolved = await reresolveReviewWorkItemFromFreshPR(result, project, workItemId);
	if (reresolved) {
		workItemId = reresolved.workItemId;
		result.workItemId = reresolved.workItemId;
		result.workItemUrl = reresolved.workItemUrl ?? result.workItemUrl;
		result.workItemTitle = reresolved.workItemTitle ?? result.workItemTitle;
		agentInput = {
			...agentInput,
			workItemId: reresolved.workItemId,
			workItemUrl: reresolved.workItemUrl ?? agentInput.workItemUrl,
			workItemTitle: reresolved.workItemTitle ?? agentInput.workItemTitle,
		};
	}

	return {
		result,
		project,
		config,
		executionConfig,
		agentType: result.agentType,
		logLabel: executionConfig.logLabel ?? 'Agent',
		pmProvider,
		lifecycle,
		lifecycleHooks,
		workItemId,
		agentInput,
	};
}

export async function persistAgentWorkItemLinks(context: AgentExecutionContext): Promise<void> {
	await persistPreRunWorkItems(context.result, context.project, context.workItemId);
}

export async function runAgentForContext(
	context: AgentExecutionContext,
	remainingBudgetUsd: number | undefined,
): Promise<AgentResult> {
	return runAgent(context.agentType, {
		...context.agentInput,
		remainingBudgetUsd,
		project: context.project,
		config: context.config,
	});
}

export async function runPostAgentSideEffects(
	context: AgentExecutionContext,
	agentResult: AgentResult,
): Promise<void> {
	if (agentResult.success && agentResult.prUrl && context.project.repo) {
		await linkPRPostExecution(
			agentResult as AgentResult & { prUrl: string },
			context.project as ProjectConfig & { repo: string },
			context.result,
			context.workItemId,
		);
	}

	await postAgentSummaryToPM(
		context.agentType,
		agentResult,
		context.workItemId,
		context.project,
		context.result.prNumber,
	);
}

export async function runAgentExecutionCallbacks(
	context: AgentExecutionContext,
	agentResult: AgentResult,
): Promise<void> {
	if (context.executionConfig.onSuccess && agentResult.success) {
		await context.executionConfig.onSuccess(context.result, agentResult);
	}

	if (context.executionConfig.onFailure && !agentResult.success) {
		await context.executionConfig.onFailure(context.result, agentResult);
	}
}
