import type { AgentInput, CascadeConfig, ProjectConfig } from '../../types/index.js';
import { type ContextFile, readContextFiles } from '../utils/setup.js';

import {
	type PromptContext,
	type TaskPromptContext,
	getSystemPrompt,
	renderCustomPrompt,
} from '../prompts/index.js';

export interface ModelConfig {
	systemPrompt: string;
	/** Resolved task prompt override from DB (undefined = use default .eta template) */
	taskPrompt?: string;
	model: string;
	maxIterations: number;
	contextFiles: ContextFile[];
}

export interface ResolveModelConfigOptions {
	agentType: string;
	project: ProjectConfig;
	config: CascadeConfig;
	repoDir: string;
	modelOverride?: string;
	promptContext?: PromptContext;
	/** Optional key override for model/iteration config lookup (e.g., respond-to-review uses 'review') */
	configKey?: string;
	/** DB partials for template include resolution */
	dbPartials?: Map<string, string>;
	/** Agent input for task-specific template variables (commentText, commentAuthor, etc.) */
	agentInput?: AgentInput;
}

/**
 * Build a merged context for DB task prompt overrides.
 * Combines PromptContext fields (cardId, prNumber, etc.) with task-specific
 * fields from AgentInput (commentText, commentAuthor, commentBody, commentPath).
 */
function buildTaskOverrideContext(
	promptContext: PromptContext | undefined,
	agentInput: AgentInput | undefined,
): TaskPromptContext {
	return {
		...(promptContext ?? {}),
		// Common fields from AgentInput
		cardId: agentInput?.cardId || (promptContext?.cardId as string | undefined),
		prNumber: agentInput?.prNumber ?? (promptContext?.prNumber as number | undefined),
		prBranch: agentInput?.prBranch ?? (promptContext?.prBranch as string | undefined),
		// Task-specific fields from AgentInput
		commentText: agentInput?.triggerCommentText as string | undefined,
		commentAuthor: (agentInput?.triggerCommentAuthor as string) || undefined,
		commentBody: agentInput?.triggerCommentBody as string | undefined,
		commentPath: (agentInput?.triggerCommentPath as string) || undefined,
	};
}

export async function resolveModelConfig(options: ResolveModelConfigOptions): Promise<ModelConfig> {
	const { agentType, project, config, repoDir, modelOverride, promptContext, dbPartials } = options;
	const configKey = options.configKey ?? agentType;

	// Resolution chain: project prompt → defaults prompt → .eta file
	const customPromptSource = project.prompts?.[agentType] ?? config.defaults.prompts?.[agentType];

	let systemPrompt: string;
	if (customPromptSource) {
		systemPrompt = renderCustomPrompt(customPromptSource, promptContext ?? {}, dbPartials);
	} else {
		systemPrompt = getSystemPrompt(agentType, promptContext ?? {}, dbPartials);
	}

	const model =
		modelOverride ||
		project.agentModels?.[configKey] ||
		project.model ||
		config.defaults.agentModels?.[configKey] ||
		config.defaults.model;

	const maxIterations =
		config.defaults.agentIterations?.[configKey] || config.defaults.maxIterations;

	// Resolve task prompt override: project → defaults → undefined (use .eta default)
	const customTaskPromptSource =
		project.taskPrompts?.[agentType] ?? config.defaults.taskPrompts?.[agentType];

	let taskPrompt: string | undefined;
	if (customTaskPromptSource) {
		const taskContext = buildTaskOverrideContext(promptContext, options.agentInput);
		taskPrompt = renderCustomPrompt(customTaskPromptSource, taskContext, dbPartials);
	}

	const contextFiles = await readContextFiles(repoDir);

	return { systemPrompt, taskPrompt, model, maxIterations, contextFiles };
}
