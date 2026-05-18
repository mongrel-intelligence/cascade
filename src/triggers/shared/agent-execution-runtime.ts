import { getAgentProfile } from '../../agents/definitions/profiles.js';
import type { LifecycleHooks } from '../../agents/definitions/schema.js';
import { runAgent } from '../../agents/registry.js';
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
	const lifecycle = new PMLifecycleManager(pmProvider, pmConfig);
	const lifecycleHooks = await loadLifecycleHooks(result.agentType);
	const { workItemId, agentInput } = await prepareAgentWorkItem(result, project.id);

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
		context.project.id,
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
