export {
	AgentDefinitionSchema,
	IntegrationHooksSchema,
	type AgentDefinition,
	type AgentCapabilities,
	type IntegrationHooks,
	type TrailingHookFlags,
	type FinishHookFlags,
} from './schema.js';
export {
	loadAgentDefinition,
	loadAllAgentDefinitions,
	getKnownAgentTypes,
	clearDefinitionCache,
	resolveAgentDefinition,
	resolveAllAgentDefinitions,
	resolveKnownAgentTypes,
	invalidateDefinitionCache,
	isPMFocusedAgent,
} from './loader.js';
export { CONTEXT_STEP_REGISTRY } from './strategies.js';
export type { FetchContextParams } from './contextSteps.js';
export type { AgentProfile } from './profiles.js';
export { getAgentProfile, getAgentCapabilities, needsGitStateStopHooks } from './profiles.js';
export { getToolManifests } from './toolManifests.js';

// Re-export capability system
export {
	CAPABILITIES,
	CAPABILITY_REGISTRY,
	type Capability,
	type CapabilityDefinition,
	getCapabilitiesByIntegration,
	getCapabilityIntegration,
	isBuiltInCapability,
	isValidCapability,
	buildGadgetsFromCapabilities,
	deriveIntegrations,
	deriveRequiredIntegrations,
	filterToolManifests,
	getGadgetNamesFromCapabilities,
	getSdkToolsFromCapabilities,
	resolveEffectiveCapabilities,
} from '../capabilities/index.js';
