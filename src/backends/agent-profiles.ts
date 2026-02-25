import { type AgentCapabilities, getAgentCapabilities } from '../agents/shared/capabilities.js';
export type { AgentCapabilities } from '../agents/shared/capabilities.js';
import type { FetchContextParams, PreExecuteParams } from '../agents/definitions/contextSteps.js';
import {
	type AgentDefinition,
	CONTEXT_STEP_REGISTRY,
	GADGET_BUILDER_REGISTRY,
	PRE_EXECUTE_REGISTRY,
	SDK_TOOLS_REGISTRY,
	TOOL_SET_REGISTRY,
	loadAgentDefinition,
} from '../agents/definitions/index.js';
import { type TaskPromptContext, renderTaskPrompt } from '../agents/prompts/index.js';
import type { AgentInput } from '../types/index.js';
import type { ContextInjection, ToolManifest } from './types.js';

// ============================================================================
// AgentProfile Interface
// ============================================================================

export interface AgentProfile {
	/** Filter the full set of tool manifests down to what this agent needs */
	filterTools(allTools: ToolManifest[]): ToolManifest[];
	/** SDK tools for Claude Code (subset of Read, Write, Edit, Bash, Glob, Grep) */
	sdkTools: string[];
	/** Whether to enable stop hooks that check for uncommitted/unpushed changes */
	enableStopHooks: boolean;
	/** Whether this profile needs the GitHub client for context fetching */
	needsGitHubToken: boolean;
	/** Whether to block git push in hooks (default: true — set false for agents on existing PR branches) */
	blockGitPush?: boolean;
	/** Whether the agent must create a PR for success (e.g., implementation) */
	requiresPR?: boolean;
	/** Fetch context injections for this agent type */
	fetchContext(params: FetchContextParams): Promise<ContextInjection[]>;
	/** Build the task prompt for this agent type */
	buildTaskPrompt(input: AgentInput): string;
	/** Optional pre-execute hook (e.g., post initial PR comment) */
	preExecute?(params: PreExecuteParams): Promise<void>;
	/** Capability summary — used by llmist backend to select gadgets */
	capabilities: AgentCapabilities;
	/**
	 * Return the gadget instances for the llmist backend.
	 * Each call creates fresh instances — caller must not reuse returned gadgets.
	 */
	getLlmistGadgets(agentType: string): unknown[];
}

// ============================================================================
// Helpers
// ============================================================================

function filterToolsByNames(allTools: ToolManifest[], names: string[]): ToolManifest[] {
	const nameSet = new Set(names);
	return allTools.filter((t) => nameSet.has(t.name));
}

function resolveRegistry<T>(registry: Record<string, T>, key: string, label: string): T {
	const value = registry[key];
	if (!value) throw new Error(`${label} '${key}' not found in registry`);
	return value;
}

/**
 * Extract all relevant fields from AgentInput into a flat context object
 * for Eta task prompt template rendering.
 */
function buildTaskPromptContext(input: AgentInput): TaskPromptContext {
	return {
		cardId: input.cardId || 'unknown',
		commentText: input.triggerCommentText as string | undefined,
		commentAuthor: (input.triggerCommentAuthor as string) || 'unknown',
		prNumber: input.prNumber,
		prBranch: input.prBranch,
		commentBody: input.triggerCommentBody as string | undefined,
		commentPath: (input.triggerCommentPath as string) || undefined,
	};
}

// ============================================================================
// Profile Builder (YAML-driven)
// ============================================================================

function buildProfileFromDefinition(agentType: string, def: AgentDefinition): AgentProfile {
	// Resolve tool names from YAML set references
	const hasAllSet = def.tools.sets.includes('all');
	const toolNames: string[] = [];
	if (!hasAllSet) {
		for (const setName of def.tools.sets) {
			const tools = TOOL_SET_REGISTRY[setName];
			if (tools) toolNames.push(...tools);
		}
	}

	const sdkTools = SDK_TOOLS_REGISTRY[def.tools.sdkTools];
	// taskPromptBuilder YAML value maps directly to the .eta template filename
	// (validated by the Zod schema in AgentDefinitionSchema)
	const taskTemplateName = def.strategies.taskPromptBuilder;
	const caps = getAgentCapabilities(agentType);
	const gadgetBuilderFn = resolveRegistry(
		GADGET_BUILDER_REGISTRY,
		def.strategies.gadgetBuilder,
		'gadgetBuilder',
	);
	const gadgetBuilderOptions = def.strategies.gadgetBuilderOptions;
	const contextPipeline = def.strategies.contextPipeline;

	const profile: AgentProfile = {
		filterTools: hasAllSet
			? (allTools) => allTools
			: (allTools) => filterToolsByNames(allTools, toolNames),
		sdkTools,
		enableStopHooks: def.backend.enableStopHooks,
		needsGitHubToken: def.backend.needsGitHubToken,
		...(def.backend.blockGitPush !== undefined && { blockGitPush: def.backend.blockGitPush }),
		...(def.backend.requiresPR && { requiresPR: true }),
		fetchContext: async (params) => {
			const injections: ContextInjection[] = [];
			for (const step of contextPipeline) {
				const stepFn = resolveRegistry(CONTEXT_STEP_REGISTRY, step, 'contextPipeline step');
				const result = await stepFn(params);
				injections.push(...result);
			}
			return injections;
		},
		buildTaskPrompt: (input) => renderTaskPrompt(taskTemplateName, buildTaskPromptContext(input)),
		capabilities: caps,
		getLlmistGadgets: (at) => gadgetBuilderFn(getAgentCapabilities(at), gadgetBuilderOptions),
	};

	if (def.backend.preExecute) {
		const preExecFn = resolveRegistry(PRE_EXECUTE_REGISTRY, def.backend.preExecute, 'preExecute');
		profile.preExecute = (params) => preExecFn(agentType, params);
	}

	return profile;
}

// ============================================================================
// Public API
// ============================================================================

export function getAgentProfile(agentType: string): AgentProfile {
	let def: AgentDefinition;
	try {
		def = loadAgentDefinition(agentType);
	} catch (err) {
		throw new Error(`Failed to load agent profile for '${agentType}'`, { cause: err });
	}
	return buildProfileFromDefinition(agentType, def);
}
