import type { ModelSpec } from 'llmist';

import { createProgressMonitor } from '../../backends/progress.js';
import { CUSTOM_MODELS } from '../../config/customModels.js';
import { recordInitialComment } from '../../gadgets/sessionState.js';
import { githubClient, withGitHubToken } from '../../github/client.js';
import { getPersonaToken } from '../../github/personas.js';
import type { AgentInput, AgentResult, CascadeConfig, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { parseRepoFullName } from '../../utils/repo.js';
import type { AgentLogger } from '../utils/logging.js';
import type { TrackingContext } from '../utils/tracking.js';
import {
	type BuilderType,
	type CreateBuilderOptions,
	createConfiguredBuilder,
} from './builderFactory.js';
import { type BaseAgentContext, executeAgentLifecycle } from './lifecycle.js';
import { setupRepository } from './repository.js';
import { injectSyntheticCall } from './syntheticCalls.js';

// ============================================================================
// Types
// ============================================================================

export interface GitHubAgentInput extends AgentInput {
	prNumber: number;
	prBranch: string;
	repoFullName: string;
	project: ProjectConfig;
	config: CascadeConfig;
}

export interface RepoIdentifier {
	owner: string;
	repo: string;
}

export interface InitialCommentResult {
	id: number;
	htmlUrl: string;
	gadgetName: string;
}

export interface GitHubAgentContext extends BaseAgentContext {
	systemPrompt: string;
}

export interface GitHubAgentDefinition<
	TInput extends GitHubAgentInput,
	TContext extends GitHubAgentContext,
> {
	agentType: string;
	headerMessage: string;
	initialCommentDescription: string;
	timeoutMessage: string;
	loggerPrefix: string;

	getGadgets(): CreateBuilderOptions['gadgets'];

	preExecute?(input: TInput, id: RepoIdentifier): Promise<AgentResult | null>;

	postInitialComment(
		input: TInput,
		id: RepoIdentifier,
		headerMessage: string,
	): Promise<InitialCommentResult>;

	buildContext(
		id: RepoIdentifier,
		input: TInput,
		repoDir: string,
		log: AgentLogger,
	): Promise<TContext>;

	injectSyntheticCalls(params: {
		builder: BuilderType;
		ctx: TContext;
		trackingContext: TrackingContext;
		repoDir: string;
		id: RepoIdentifier;
		input: TInput;
	}): Promise<BuilderType>;

	wrapExecution?(input: TInput, runLifecycle: () => Promise<AgentResult>): Promise<AgentResult>;

	builderOptions?: Pick<CreateBuilderOptions, 'postConfigure' | 'skipSessionState'>;
}

// ============================================================================
// Default Helpers
// ============================================================================

export async function createInitialPRComment(
	prNumber: number,
	id: RepoIdentifier,
	headerMessage: string,
): Promise<InitialCommentResult> {
	const comment = await githubClient.createPRComment(id.owner, id.repo, prNumber, headerMessage);
	return { id: comment.id, htmlUrl: comment.htmlUrl, gadgetName: 'PostPRComment' };
}

// ============================================================================
// Shared Execution
// ============================================================================

export async function executeGitHubAgent<
	TInput extends GitHubAgentInput,
	TContext extends GitHubAgentContext,
>(definition: GitHubAgentDefinition<TInput, TContext>, input: TInput): Promise<AgentResult> {
	const { prNumber, prBranch, repoFullName, project, interactive, autoAccept } = input;

	let owner: string;
	let repo: string;
	try {
		({ owner, repo } = parseRepoFullName(repoFullName));
	} catch {
		return { success: false, output: '', error: `Invalid repo format: ${repoFullName}` };
	}
	const id: RepoIdentifier = { owner, repo };

	if (definition.preExecute) {
		const earlyResult = await definition.preExecute(input, id);
		if (earlyResult) return earlyResult;
	}

	const runLifecycle = () =>
		executeAgentLifecycle<TContext>({
			loggerIdentifier: `${definition.loggerPrefix}-${prNumber}`,

			onWatchdogTimeout: async () => {
				await githubClient.createPRComment(owner, repo, prNumber, definition.timeoutMessage);
				logger.info('Posted timeout notice to PR', { prNumber });
			},

			setupRepoDir: (log) =>
				setupRepository({ project, log, agentType: definition.agentType, prBranch }),

			buildContext: (repoDir, log) => definition.buildContext(id, input, repoDir, log),

			createBuilder: ({
				client,
				ctx,
				llmistLogger,
				trackingContext,
				fileLogger,
				repoDir,
				progressMonitor,
				llmCallAccumulator,
				runId,
			}) =>
				createConfiguredBuilder({
					client,
					agentType: definition.agentType,
					model: ctx.model,
					systemPrompt: ctx.systemPrompt,
					maxIterations: ctx.maxIterations,
					llmistLogger,
					trackingContext,
					logWriter: fileLogger.write.bind(fileLogger),
					llmCallLogger: fileLogger.llmCallLogger,
					repoDir,
					gadgets: definition.getGadgets(),
					progressMonitor: progressMonitor ?? undefined,
					remainingBudgetUsd: input.remainingBudgetUsd as number | undefined,
					llmCallAccumulator,
					runId,
					baseBranch: project.baseBranch,
					projectId: project.id,
					cardId: input.cardId,
					...definition.builderOptions,
				}),

			injectSyntheticCalls: async ({ builder, ctx, trackingContext, repoDir }) => {
				const initialComment = await definition.postInitialComment(
					input,
					id,
					definition.headerMessage,
				);
				recordInitialComment(initialComment.id);
				const withComment = injectSyntheticCall(
					builder,
					trackingContext,
					initialComment.gadgetName,
					{
						comment: definition.initialCommentDescription,
						owner,
						repo,
						prNumber,
						body: definition.headerMessage,
					},
					`Comment posted (id: ${initialComment.id}): ${initialComment.htmlUrl}`,
					'gc_initial_comment',
				);

				return definition.injectSyntheticCalls({
					builder: withComment,
					ctx,
					trackingContext,
					repoDir,
					id,
					input,
				});
			},

			createProgressMonitor: (fileLogger, _repoDir) =>
				createProgressMonitor({
					logWriter: fileLogger.write.bind(fileLogger),
					agentType: definition.agentType,
					taskDescription: `PR #${prNumber} in ${repoFullName}`,
					progressModel: input.config.defaults.progressModel,
					intervalMinutes: input.config.defaults.progressIntervalMinutes,
					customModels: CUSTOM_MODELS as ModelSpec[],
					github: { owner, repo, headerMessage: definition.headerMessage },
				}),

			interactive,
			autoAccept,
			customModels: CUSTOM_MODELS,

			runTracking: {
				projectId: project.id,
				cardId: input.cardId,
				prNumber,
				agentType: definition.agentType,
				backendName: 'llmist',
				triggerType: input.triggerType,
			},
		});

	// Resolve the persona-based GitHub token (GITHUB_TOKEN_IMPLEMENTER or GITHUB_TOKEN_REVIEWER)
	// for all PR interactions (comments, reviews). Individual agents can add further wrapping via wrapExecution.
	const agentGitHubToken = await getPersonaToken(input.project.id, definition.agentType);
	const scopedLifecycle = () => withGitHubToken(agentGitHubToken, runLifecycle);

	if (definition.wrapExecution) {
		return definition.wrapExecution(input, scopedLifecycle);
	}
	return scopedLifecycle();
}
