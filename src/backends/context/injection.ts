import type { PromptContext } from '../../agents/prompts/index.js';
import { resolveModelConfig } from '../../agents/shared/modelResolution.js';
import type { ContextFile } from '../../agents/utils/setup.js';
import type { AgentInput, CascadeConfig, ProjectConfig } from '../../types/index.js';
import { getAgentProfile } from '../agent-profiles.js';
import type { ContextInjection, LogWriter, ToolManifest } from '../types.js';

export interface BuildContextParams {
	agentType: string;
	input: AgentInput & { project: ProjectConfig; config: CascadeConfig };
	repoDir: string;
	logWriter: LogWriter;
	availableTools: ToolManifest[];
}

export interface BackendContextResult {
	systemPrompt: string;
	taskPrompt: string;
	contextInjections: ContextInjection[];
	filteredTools: ToolManifest[];
	model: string;
	maxIterations: number;
	sdkTools: string[];
	enableStopHooks: boolean;
	contextFiles: ContextFile[];
}

/**
 * Build complete backend context including prompts, tools, and injections.
 * Uses agent profiles to customize context per agent type.
 */
export async function buildBackendContext(
	params: BuildContextParams,
): Promise<BackendContextResult> {
	const { agentType, input, repoDir, logWriter, availableTools } = params;
	const { project, config, cardId } = input;

	const pmType = project.pm?.type ?? 'trello';
	const promptContext: PromptContext = {
		cardId,
		cardUrl: cardId
			? pmType === 'jira' && project.jira
				? `${project.jira.baseUrl}/browse/${cardId}`
				: `https://trello.com/c/${cardId}`
			: undefined,
		projectId: project.id,
		baseBranch: project.baseBranch,
		storiesListId: project.trello?.lists?.stories,
		processedLabelId: project.trello?.labels?.processed,
		pmType,
	};

	const { systemPrompt, model, maxIterations, contextFiles } = await resolveModelConfig({
		agentType,
		project,
		config,
		repoDir,
		promptContext,
	});

	const profile = getAgentProfile(agentType);

	// Use profile to fetch agent-specific context injections
	const contextInjections = await profile.fetchContext({
		input,
		repoDir,
		contextFiles,
		logWriter,
	});

	return {
		systemPrompt,
		taskPrompt: profile.buildTaskPrompt(input),
		contextInjections,
		filteredTools: profile.filterTools(availableTools),
		model,
		maxIterations,
		sdkTools: profile.sdkTools,
		enableStopHooks: profile.enableStopHooks,
		contextFiles,
	};
}
