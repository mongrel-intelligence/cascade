/**
 * Agent Profiles
 *
 * Builds runtime profiles from agent definitions using the capability-centric architecture.
 * Capabilities determine tools, gadgets, and integration requirements.
 */

import type { AgentInput } from '../../types/index.js';
import type { Capability, IntegrationChecker } from '../capabilities/index.js';
import {
	deriveRequiredIntegrations,
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
import type { FetchContextParams } from './contextSteps.js';
import { resolveAgentDefinition } from './loader.js';
import type {
	AgentCapabilities,
	AgentDefinition,
	ContextStepName,
	FinishHookFlags,
	SupportedTrigger,
} from './schema.js';
import { CONTEXT_STEP_REGISTRY } from './strategies.js';

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
	/** Whether this profile needs the GitHub client for context fetching */
	needsGitHubToken: boolean;
	/** Finish hook flags (SCM requirements: requiresPR, requiresReview, etc.) */
	finishHooks: FinishHookFlags;
	/** Fetch context injections for this agent type */
	fetchContext(params: FetchContextParams): Promise<ContextInjection[]>;
	/** Build the task prompt for this agent type */
	buildTaskPrompt(input: AgentInput): string;
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

/**
 * Resolve finish hooks from an agent definition.
 */
function resolveFinishHooks(def: AgentDefinition): FinishHookFlags {
	const scm = def.hooks?.finish?.scm;
	return {
		requiresPR: scm?.requiresPR,
		requiresReview: scm?.requiresReview,
		requiresPushedChanges: scm?.requiresPushedChanges,
		blockGitPush: scm?.blockGitPush,
	};
}

/** Stop hooks are needed when any finish validation requirement is set. */
export function hasFinishValidation(hooks: FinishHookFlags): boolean {
	return !!(hooks.requiresPR || hooks.requiresReview || hooks.requiresPushedChanges);
}

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

/**
 * Derive whether an agent requires GitHub token access.
 *
 * Checks explicit integrations first (def.integrations.required contains 'scm'),
 * then falls back to capability-derived integrations when explicit integrations
 * are not declared.
 */
function requiresScmIntegration(def: AgentDefinition): boolean {
	if (def.integrations?.required) {
		return def.integrations.required.includes('scm');
	}
	return deriveRequiredIntegrations(def.capabilities.required).includes('scm');
}

/**
 * Resolve the context pipeline for a given trigger event.
 *
 * Returns the trigger-specific pipeline if defined, otherwise returns an empty array.
 * This function handles several edge cases gracefully:
 *
 * - **No triggerEvent**: Returns `[]` when triggerEvent is undefined or empty string.
 *   This happens when an agent is invoked manually without a trigger.
 * - **No matching trigger**: Returns `[]` when the triggerEvent doesn't match any
 *   trigger in the agent's triggers array. This could happen if a trigger is
 *   misconfigured or the agent doesn't support the given event.
 * - **Trigger without contextPipeline**: Returns `[]` when the matching trigger
 *   exists but has no contextPipeline defined (contextPipeline is optional).
 * - **Empty triggers array**: Returns `[]` for agents with no triggers (e.g., debug
 *   agent which is only invoked internally).
 *
 * @param triggers - Array of supported triggers from the agent definition
 * @param triggerEvent - Optional trigger event (e.g., 'pm:status-changed', 'scm:check-suite-success')
 * @returns The context pipeline to use (empty array for any edge case)
 */
function resolveContextPipeline(
	triggers: SupportedTrigger[],
	triggerEvent?: string,
): ContextStepName[] {
	if (!triggerEvent) {
		return [];
	}

	const trigger = triggers.find((t) => t.event === triggerEvent);
	return trigger?.contextPipeline ?? [];
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

	// Get triggers for dynamic context pipeline resolution
	const triggers = def.triggers ?? [];

	// Get task prompt template from prompts (required by schema)
	const taskPromptTemplate = def.prompts.taskPrompt;

	// Validate Eta syntax early to catch errors at profile build time
	const validationResult = validateTemplate(taskPromptTemplate);
	if (!validationResult.valid) {
		throw new Error(`Agent '${agentType}' has invalid taskPrompt: ${validationResult.error}`);
	}

	// Resolve finish hooks
	const finish = resolveFinishHooks(def);

	const profile: AgentProfile = {
		filterTools: (allTools: ToolManifest[]) => {
			// Filter tools by the gadget names derived from capabilities
			const nameSet = new Set(gadgetNames);
			return allTools.filter((t) => nameSet.has(t.name));
		},
		sdkTools,
		needsGitHubToken: requiresScmIntegration(def),
		finishHooks: finish,
		fetchContext: async (params) => {
			// Resolve context pipeline from the trigger (empty array if no trigger or trigger has no pipeline)
			const contextPipeline = resolveContextPipeline(triggers, params.input.triggerType);

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
