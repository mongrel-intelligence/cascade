/**
 * Capability Registry
 *
 * Defines the mapping from capabilities to their source integrations,
 * gadgets, SDK tools, and CLI tools.
 *
 * Core principle: Integrations provide capabilities. Capabilities provide tools.
 *
 * Integration Category → Capabilities → Gadgets/Tools
 */

import type { IntegrationCategory } from '../definitions/schema.js';

// ============================================================================
// Capability Types
// ============================================================================

/**
 * All available capabilities in the system.
 *
 * Format: {source}:{action}
 * - Built-in sources: fs (filesystem), shell, session
 * - Integration sources: pm, scm, email
 */
export const CAPABILITIES = [
	// Built-in capabilities (always available, no integration required)
	'fs:read',
	'fs:write',
	'shell:exec',
	'session:ctrl',

	// PM integration capabilities
	'pm:read',
	'pm:write',
	'pm:checklist',

	// SCM integration capabilities
	'scm:read',
	'scm:ci-logs',
	'scm:comment',
	'scm:review',
	'scm:pr',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Capability definition describing what a capability provides.
 */
export interface CapabilityDefinition {
	/** Integration category that provides this capability (null = built-in) */
	integration: IntegrationCategory | null;
	/** Description for UI display */
	description: string;
	/** Gadget class names this capability enables */
	gadgetNames: string[];
	/** SDK tool names for Claude Code backend */
	sdkToolNames: string[];
	/** CLI tool commands for cascade-tools (currently unused but reserved) */
	cliToolNames: string[];
}

// ============================================================================
// Capability Registry
// ============================================================================

/**
 * Registry mapping capabilities to their definitions.
 *
 * This is the single source of truth for capability → tool mappings.
 */
export const CAPABILITY_REGISTRY: Record<Capability, CapabilityDefinition> = {
	// -------------------------------------------------------------------------
	// Built-in capabilities (always available)
	// -------------------------------------------------------------------------

	'fs:read': {
		integration: null,
		description: 'Read files, list directories, search code',
		gadgetNames: ['ListDirectory', 'ReadFile', 'RipGrep', 'AstGrep'],
		sdkToolNames: ['Read', 'Glob', 'Grep'],
		cliToolNames: [],
	},

	'fs:write': {
		integration: null,
		description: 'Write and edit files',
		gadgetNames: ['WriteFile', 'FileSearchAndReplace', 'FileMultiEdit', 'VerifyChanges'],
		sdkToolNames: ['Write', 'Edit'],
		cliToolNames: [],
	},

	'shell:exec': {
		integration: null,
		description: 'Execute shell commands',
		gadgetNames: ['Tmux', 'Sleep'],
		sdkToolNames: ['Bash'],
		cliToolNames: [],
	},

	'session:ctrl': {
		integration: null,
		description: 'Session control and task tracking',
		gadgetNames: ['Finish', 'TodoUpsert', 'TodoUpdateStatus', 'TodoDelete'],
		sdkToolNames: [],
		cliToolNames: [],
	},

	// -------------------------------------------------------------------------
	// PM integration capabilities
	// -------------------------------------------------------------------------

	'pm:read': {
		integration: 'pm',
		description: 'Read work items from PM system',
		gadgetNames: ['ReadWorkItem', 'ListWorkItems'],
		sdkToolNames: [],
		cliToolNames: [],
	},

	'pm:write': {
		integration: 'pm',
		description: 'Create and update work items, post comments',
		gadgetNames: [
			'UpdateWorkItem',
			'CreateWorkItem',
			'MoveWorkItem',
			'PostComment',
			'AddChecklist',
		],
		sdkToolNames: [],
		cliToolNames: [],
	},

	'pm:checklist': {
		integration: 'pm',
		description: 'Update and delete checklist items',
		gadgetNames: ['PMUpdateChecklistItem', 'PMDeleteChecklistItem'],
		sdkToolNames: [],
		cliToolNames: [],
	},

	// -------------------------------------------------------------------------
	// SCM integration capabilities
	// -------------------------------------------------------------------------

	'scm:read': {
		integration: 'scm',
		description: 'Read PR details, diffs, and checks',
		gadgetNames: ['GetPRDetails', 'GetPRDiff', 'GetPRChecks'],
		sdkToolNames: [],
		cliToolNames: [],
	},

	'scm:ci-logs': {
		integration: 'scm',
		description: 'Download CI run failure logs',
		gadgetNames: ['GetCIRunLogs'],
		sdkToolNames: [],
		cliToolNames: [],
	},

	'scm:comment': {
		integration: 'scm',
		description: 'Post and update PR comments',
		gadgetNames: ['PostPRComment', 'UpdatePRComment', 'GetPRComments', 'ReplyToReviewComment'],
		sdkToolNames: [],
		cliToolNames: [],
	},

	'scm:review': {
		integration: 'scm',
		description: 'Submit code reviews',
		gadgetNames: ['CreatePRReview'],
		sdkToolNames: [],
		cliToolNames: [],
	},

	'scm:pr': {
		integration: 'scm',
		description: 'Create pull requests',
		gadgetNames: ['CreatePR'],
		sdkToolNames: [],
		cliToolNames: [],
	},
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get capabilities grouped by integration source for UI display.
 */
export function getCapabilitiesByIntegration(): Record<
	IntegrationCategory | 'builtin',
	Capability[]
> {
	const groups: Record<IntegrationCategory | 'builtin', Capability[]> = {
		builtin: [],
		pm: [],
		scm: [],
	};

	for (const cap of CAPABILITIES) {
		const def = CAPABILITY_REGISTRY[cap];
		const key = def.integration ?? 'builtin';
		groups[key].push(cap);
	}

	return groups;
}

/**
 * Extract the integration category from a capability name.
 * Returns null for built-in capabilities.
 */
export function getCapabilityIntegration(cap: Capability): IntegrationCategory | null {
	return CAPABILITY_REGISTRY[cap].integration;
}

/**
 * Check if a capability is built-in (no integration required).
 */
export function isBuiltInCapability(cap: Capability): boolean {
	return CAPABILITY_REGISTRY[cap].integration === null;
}

/**
 * Validate that a string is a valid capability.
 */
export function isValidCapability(value: string): value is Capability {
	return CAPABILITIES.includes(value as Capability);
}
