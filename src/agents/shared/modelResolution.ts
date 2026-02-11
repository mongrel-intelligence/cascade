import type { CascadeConfig, ProjectConfig } from '../../types/index.js';
import { type ContextFile, readContextFiles } from '../utils/setup.js';

import { type PromptContext, getSystemPrompt } from '../prompts/index.js';

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
}

export async function resolveModelConfig(options: ResolveModelConfigOptions): Promise<ModelConfig> {
	const { agentType, project, config, repoDir, modelOverride, promptContext } = options;
	const configKey = options.configKey ?? agentType;

	const systemPrompt =
		project.prompts?.[agentType] || getSystemPrompt(agentType, promptContext ?? {});

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
