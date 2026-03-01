export { AgentDefinitionSchema, type AgentDefinition, type AgentCapabilities } from './schema.js';
export {
	loadAgentDefinition,
	loadAllAgentDefinitions,
	getKnownAgentTypes,
	clearDefinitionCache,
	resolveAgentDefinition,
	resolveAllAgentDefinitions,
	resolveKnownAgentTypes,
	invalidateDefinitionCache,
} from './loader.js';
export { CONTEXT_STEP_REGISTRY, PRE_EXECUTE_REGISTRY } from './strategies.js';
export type { FetchContextParams, PreExecuteParams } from './contextSteps.js';
export type { AgentProfile } from './profiles.js';
export { getAgentProfile, getAgentCapabilities } from './profiles.js';
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
