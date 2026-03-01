/**
 * Capability-centric architecture for agent tool management.
 *
 * Core principle: Integrations provide capabilities. Capabilities provide tools.
 *
 * ```
 * Integration Category → Capabilities → Gadgets/Tools
 *        │                    │              │
 *        pm          →    pm:read     →  ReadWorkItem, ListWorkItems
 *                         pm:write    →  CreateWorkItem, UpdateWorkItem, PostComment
 *                         pm:checklist → PMUpdateChecklistItem, PMDeleteChecklistItem
 *
 *        scm         →    scm:read    →  GetPRDetails, GetPRDiff, GetPRChecks
 *                         scm:comment →  PostPRComment, UpdatePRComment
 *                         scm:review  →  CreatePRReview
 *                         scm:pr      →  CreatePR
 *
 *        (built-in)  →    fs:read     →  ReadFile, ListDirectory, RipGrep, AstGrep
 *                         fs:write    →  WriteFile, FileSearchAndReplace, FileMultiEdit
 *                         shell:exec  →  Tmux, Sleep
 *                         session:ctrl → Finish, TodoUpsert/Update/Delete
 * ```
 */

// Registry
export {
	CAPABILITIES,
	CAPABILITY_REGISTRY,
	type Capability,
	type CapabilityDefinition,
	getCapabilitiesByIntegration,
	getCapabilityIntegration,
	isBuiltInCapability,
	isValidCapability,
} from './registry.js';

// Resolver
export {
	buildGadgetsFromCapabilities,
	createIntegrationChecker,
	deriveIntegrations,
	deriveRequiredIntegrations,
	filterToolManifests,
	generateUnavailableCapabilitiesNote,
	getGadgetNamesFromCapabilities,
	getSdkToolsFromCapabilities,
	getUnavailableOptionalCapabilities,
	type IntegrationChecker,
	resolveEffectiveCapabilities,
} from './resolver.js';
