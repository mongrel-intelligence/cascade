// Re-export capability system
export {
	buildGadgetsFromCapabilities,
	CAPABILITIES,
	CAPABILITY_REGISTRY,
	type Capability,
	type CapabilityDefinition,
	deriveIntegrations,
	deriveRequiredIntegrations,
	filterToolManifests,
	getCapabilitiesByIntegration,
	getCapabilityIntegration,
	getGadgetNamesFromCapabilities,
	getSdkToolsFromCapabilities,
	isBuiltInCapability,
	isValidCapability,
	resolveEffectiveCapabilities,
} from '../capabilities/index.js';
export type { FetchContextParams } from './contextSteps.js';
export {
	clearDefinitionCache,
	getBuiltinAgentTypes,
	invalidateDefinitionCache,
	isBuiltinAgentType,
	isPMFocusedAgent,
	loadBuiltinDefinition,
	resolveAgentDefinition,
	resolveAllAgentDefinitions,
	resolveKnownAgentTypes,
} from './loader.js';
export type { AgentProfile } from './profiles.js';
export { getAgentCapabilities, getAgentProfile, needsGitStateStopHooks } from './profiles.js';
export {
	type AgentCapabilities,
	type AgentDefinition,
	AgentDefinitionSchema,
	type FinishHookFlags,
	type IntegrationHooks,
	IntegrationHooksSchema,
	type TrailingHookFlags,
} from './schema.js';
export { CONTEXT_STEP_REGISTRY } from './strategies.js';
export { getToolManifests } from './toolManifests.js';
