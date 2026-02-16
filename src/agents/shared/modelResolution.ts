import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import { type ContextFile, readContextFiles } from '../utils/setup.js';

import { type PromptContext, getSystemPrompt, renderCustomPrompt } from '../prompts/index.js';

export interface ModelConfig {
	systemPrompt: string;
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

	const contextFiles = await readContextFiles(repoDir);

	return { systemPrompt, model, maxIterations, contextFiles };
}
