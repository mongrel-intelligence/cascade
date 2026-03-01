/**
 * Agent Profiles
 *
 * Builds runtime profiles from agent definitions using the capability-centric architecture.
 * Capabilities determine tools, gadgets, and integration requirements.
 */

import type { AgentInput } from '../../types/index.js';
import type { Capability, IntegrationChecker } from '../capabilities/index.js';
import {
	getGadgetNamesFromCapabilities,
	getSdkToolsFromCapabilities,
	resolveEffectiveCapabilities,
} from '../capabilities/resolver.js';
import type { ContextInjection, ToolManifest } from '../contracts/index.js';
import {
	buildTaskPromptContext,
	renderInlineTaskPrompt,
	validateTemplate,
} from '../prompts/index.js';
import { buildGadgetsForAgent } from '../shared/gadgets.js';
import type { FetchContextParams, PreExecuteParams } from './contextSteps.js';
import { resolveAgentDefinition } from './loader.js';
import type { AgentCapabilities, AgentDefinition } from './schema.js';
import { CONTEXT_STEP_REGISTRY, PRE_EXECUTE_REGISTRY } from './strategies.js';

// Re-export for backward compatibility
export type { AgentCapabilities } from './schema.js';

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
	/** Agent capabilities (required + optional) */
	capabilities: AgentCapabilities;
	/**
	 * Return the gadget instances for the llmist backend.
	 * Each call creates fresh instances — caller must not reuse returned gadgets.
	 *
	 * @param integrationChecker Optional callback to check integration availability.
	 *   When provided, optional capabilities are filtered to only those with
	 *   available integrations. When not provided, all capabilities are used.
	 */
	getLlmistGadgets(integrationChecker?: IntegrationChecker): unknown[];
}

// ============================================================================
// Helpers
// ============================================================================

function resolveRegistry<T>(registry: Record<string, T>, key: string, label: string): T {
	const value = registry[key];
	if (!value) throw new Error(`${label} '${key}' not found in registry`);
	return value;
}

/**
 * Merge required and optional capabilities into a single list.
 * In runtime, we use all declared capabilities (validation happens separately).
 */
function getAllCapabilities(caps: AgentCapabilities): Capability[] {
	return [...caps.required, ...caps.optional];
}

// ============================================================================
// Profile Builder (Capability-driven)
// ============================================================================

function buildProfileFromDefinition(def: AgentDefinition, agentType: string): AgentProfile {
	const allCapabilities = getAllCapabilities(def.capabilities);

	// Derive tool names from capabilities for filtering
	const gadgetNames = getGadgetNamesFromCapabilities(allCapabilities);

	// Derive SDK tools from capabilities
	const sdkTools = getSdkToolsFromCapabilities(allCapabilities);

	// Get gadget options from strategies
	const gadgetOptions = def.strategies.gadgetOptions;

	// Get context pipeline from strategies
	const contextPipeline = def.strategies.contextPipeline;

	// Get task prompt template from prompts (required by schema)
	const taskPromptTemplate = def.prompts.taskPrompt;

	// Validate Eta syntax early to catch errors at profile build time
	const validationResult = validateTemplate(taskPromptTemplate);
	if (!validationResult.valid) {
		throw new Error(`Agent '${agentType}' has invalid taskPrompt: ${validationResult.error}`);
	}

	const profile: AgentProfile = {
		filterTools: (allTools: ToolManifest[]) => {
			// Filter tools by the gadget names derived from capabilities
			const nameSet = new Set(gadgetNames);
			return allTools.filter((t) => nameSet.has(t.name));
		},
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
		buildTaskPrompt: (input) =>
			renderInlineTaskPrompt(taskPromptTemplate, buildTaskPromptContext(input)),
		capabilities: def.capabilities,
		getLlmistGadgets: (integrationChecker?: IntegrationChecker) => {
			// Resolve effective capabilities based on integration availability
			const effectiveCaps = integrationChecker
				? resolveEffectiveCapabilities(
						def.capabilities.required,
						def.capabilities.optional,
						integrationChecker,
					)
				: allCapabilities;
			return buildGadgetsForAgent(effectiveCaps, gadgetOptions);
		},
	};

	if (def.backend.preExecute) {
		const preExecFn = resolveRegistry(PRE_EXECUTE_REGISTRY, def.backend.preExecute, 'preExecute');
		// Pass agentType so the hook can look up initial messages
		profile.preExecute = (params) => preExecFn(agentType, params);
	}

	return profile;
}

// ============================================================================
// Public API
// ============================================================================

export async function getAgentProfile(agentType: string): Promise<AgentProfile> {
	let def: AgentDefinition;
	try {
		def = await resolveAgentDefinition(agentType);
	} catch (err) {
		throw new Error(`Failed to load agent profile for '${agentType}'`, { cause: err });
	}
	return buildProfileFromDefinition(def, agentType);
}

/**
 * Get agent capabilities from a definition.
 * Used for backward compatibility with code that expects the old format.
 */
export async function getAgentCapabilities(agentType: string): Promise<AgentCapabilities> {
	const def = await resolveAgentDefinition(agentType);
	return def.capabilities;
}
