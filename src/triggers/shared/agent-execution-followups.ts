import type { AgentResult } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import type { TriggerResult } from '../types.js';
import type { AgentExecutionConfig, AgentExecutionContext } from './agent-execution-types.js';
import { buildPostCompletionReviewDispatch } from './post-completion-review.js';
import { buildSplittingAutoChainDispatch } from './splitting-auto-chain.js';

export type AgentExecutionRunner = (
	result: TriggerResult,
	project: AgentExecutionContext['project'],
	config: AgentExecutionContext['config'],
	executionConfig?: AgentExecutionConfig,
) => Promise<void>;

async function dispatchPostCompletionReview(
	context: AgentExecutionContext,
	agentResult: AgentResult,
	runner: AgentExecutionRunner,
): Promise<void> {
	if (context.agentType !== 'implementation' || !agentResult.success || !agentResult.prUrl) return;
	if (!context.project.repo) return;

	const reviewResult = await buildPostCompletionReviewDispatch(
		agentResult,
		context.project,
		context.workItemId,
	);
	if (!reviewResult) return;

	try {
		await runner(reviewResult, context.project, context.config, {
			...context.executionConfig,
			skipPrepareForAgent: true,
			skipHandleFailure: true,
			logLabel: 'review (post-completion)',
		});
	} catch (err) {
		logger.warn('Post-completion review pipeline failed (non-fatal)', {
			prUrl: agentResult.prUrl,
			workItemId: context.workItemId,
			error: String(err),
		});
	}
}

async function dispatchSplittingAutoChain(
	context: AgentExecutionContext,
	agentResult: AgentResult,
	runner: AgentExecutionRunner,
): Promise<void> {
	if (context.agentType !== 'splitting' || !agentResult.success || !context.workItemId) return;

	const chainResult = await buildSplittingAutoChainDispatch(context.workItemId, context.project);
	if (!chainResult) return;

	await runner(chainResult, context.project, context.config, {
		...context.executionConfig,
		skipPrepareForAgent: true,
		skipHandleFailure: true,
		logLabel: 'backlog-manager (auto-chain)',
	});
}

/**
 * Dispatch recursive follow-up work owned by the execution facade.
 *
 * The facade passes itself as `runner` so recursion remains centralized while
 * this module owns the trigger-specific follow-up decisions.
 */
export async function dispatchAgentFollowUps(
	context: AgentExecutionContext,
	agentResult: AgentResult,
	runner: AgentExecutionRunner,
): Promise<void> {
	await dispatchPostCompletionReview(context, agentResult, runner);
	await dispatchSplittingAutoChain(context, agentResult, runner);
}
