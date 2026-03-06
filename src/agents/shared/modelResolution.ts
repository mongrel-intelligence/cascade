import type { AgentInput, CascadeConfig, ProjectConfig } from '../../types/index.js';
import { logger } from '../../utils/logging.js';
import { resolveAgentDefinition } from '../definitions/loader.js';
import {
	type PromptContext,
	buildTaskPromptContext,
	getSystemPrompt,
	renderCustomPrompt,
	renderInlineTaskPrompt,
} from '../prompts/index.js';
import { type ContextFile, readContextFiles } from '../utils/setup.js';

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

export async function resolveModelConfig(options: ResolveModelConfigOptions): Promise<ModelConfig> {
	const { agentType, project, config, repoDir, modelOverride, promptContext, dbPartials } = options;
	const configKey = options.configKey ?? agentType;

	// Resolve prompts from agent definition (cache → DB → YAML)
	let definitionSystemPrompt: string | undefined;
	let definitionTaskPrompt: string | undefined;
	try {
		const definition = await resolveAgentDefinition(agentType);
		definitionSystemPrompt = definition.prompts?.systemPrompt;
		definitionTaskPrompt = definition.prompts?.taskPrompt;
	} catch (err) {
		// Definition not found or DB unavailable — fall through to defaults
		logger.warn(`Failed to resolve agent definition for ${agentType}:`, err);
	}

	// Resolution chain: definition prompt → .eta file
	let systemPrompt: string;
	if (definitionSystemPrompt) {
		systemPrompt = renderCustomPrompt(definitionSystemPrompt, promptContext ?? {}, dbPartials);
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

	// Resolve task prompt override from definition → undefined (use .eta default)
	let taskPrompt: string | undefined;
	if (definitionTaskPrompt) {
		// Build task context from agentInput, falling back to promptContext for common fields
		const taskContext = {
			// Forward all prompt context (PM list IDs, vocabulary, etc.) so task
			// prompts can reference any system-level variable via Eta.
			...promptContext,
			// Task-specific fields from agentInput override prompt context
			...buildTaskPromptContext({
				cardId: options.agentInput?.cardId ?? promptContext?.cardId,
				prNumber: options.agentInput?.prNumber ?? (promptContext?.prNumber as number | undefined),
				prBranch: options.agentInput?.prBranch ?? (promptContext?.prBranch as string | undefined),
				triggerCommentText: options.agentInput?.triggerCommentText,
				triggerCommentAuthor: options.agentInput?.triggerCommentAuthor,
				triggerCommentBody: options.agentInput?.triggerCommentBody,
				triggerCommentPath: options.agentInput?.triggerCommentPath,
				senderEmail: options.agentInput?.senderEmail,
			}),
		};
		taskPrompt = renderInlineTaskPrompt(definitionTaskPrompt, taskContext, dbPartials);
	}

	const contextFiles = await readContextFiles(repoDir);

	return { systemPrompt, taskPrompt, model, maxIterations, contextFiles };
}
