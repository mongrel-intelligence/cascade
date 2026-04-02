/**
 * Agent Capabilities
 *
 * Re-exports capability types and functions from the new capability registry.
 *
 * This file is kept for backward compatibility. New code should import from:
 * - '../capabilities/index.js' for full capability system
 * - '../definitions/schema.js' for AgentCapabilities type
 */

// Re-export capability functions
export {
	buildGadgetsFromCapabilities,
	CAPABILITIES,
	CAPABILITY_REGISTRY,
	deriveIntegrations,
	deriveRequiredIntegrations,
	filterToolManifests,
	generateUnavailableCapabilitiesNote,
	getCapabilitiesByIntegration,
	getCapabilityIntegration,
	getGadgetNamesFromCapabilities,
	getSdkToolsFromCapabilities,
	getUnavailableOptionalCapabilities,
	isBuiltInCapability,
	isValidCapability,
	resolveEffectiveCapabilities,
} from '../capabilities/index.js';
// Re-export capability types
export type { AgentCapabilities, Capability } from '../definitions/schema.js';

import { resolveAgentDefinition } from '../definitions/index.js';

/**
 * Legacy interface for derived capability flags.
 * Used by code that needs boolean capability checks.
 */
export interface LegacyCapabilities {
	canEditFiles: boolean;
	canCreatePR: boolean;
	canUpdateChecklists: boolean;
	isReadOnly: boolean;
}

/**
 * Get legacy capability flags for an agent type.
 *
 * Derives boolean capability flags from the new capability array format:
 * - canEditFiles = has 'fs:write'
 * - canCreatePR = has 'scm:pr'
 * - canUpdateChecklists = has 'pm:checklist'
 * - isReadOnly = does not have 'fs:write'
 *
 * For unknown agent types, returns full-access defaults to maintain
 * backward compatibility.
 */
export async function getAgentCapabilities(agentType: string): Promise<LegacyCapabilities> {
	try {
		const def = await resolveAgentDefinition(agentType);
		const allCaps = [...def.capabilities.required, ...def.capabilities.optional];

		return {
			canEditFiles: allCaps.includes('fs:write'),
			canCreatePR: allCaps.includes('scm:pr'),
			canUpdateChecklists: allCaps.includes('pm:checklist'),
			isReadOnly: !allCaps.includes('fs:write'),
		};
	} catch (error) {
		// Only fall back to full access for "agent not found" errors.
		// Re-throw unexpected errors to avoid masking bugs with elevated privileges.
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('not found')) {
			// Unknown agent type - return full-access defaults for backward compatibility
			return {
				canEditFiles: true,
				canCreatePR: true,
				canUpdateChecklists: true,
				isReadOnly: false,
			};
		}
		throw error;
	}
}
