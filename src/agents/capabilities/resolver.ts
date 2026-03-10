/**
 * Capability Resolver
 *
 * Functions for deriving integrations, tools, and gadgets from capabilities.
 */

import { AstGrep } from '../../gadgets/AstGrep.js';
import { FileMultiEdit } from '../../gadgets/FileMultiEdit.js';
import { FileSearchAndReplace } from '../../gadgets/FileSearchAndReplace.js';
import { Finish } from '../../gadgets/Finish.js';
import { ListDirectory } from '../../gadgets/ListDirectory.js';
import { ReadFile } from '../../gadgets/ReadFile.js';
import { RipGrep } from '../../gadgets/RipGrep.js';
import { Sleep } from '../../gadgets/Sleep.js';
import { VerifyChanges } from '../../gadgets/VerifyChanges.js';
import { WriteFile } from '../../gadgets/WriteFile.js';
import {
	MarkEmailAsSeen,
	ReadEmail,
	ReplyToEmail,
	SearchEmails,
	SendEmail,
} from '../../gadgets/email/index.js';
import {
	CreatePR,
	CreatePRReview,
	GetCIRunLogs,
	GetPRChecks,
	GetPRComments,
	GetPRDetails,
	GetPRDiff,
	PostPRComment,
	ReplyToReviewComment,
	UpdatePRComment,
} from '../../gadgets/github/index.js';
import {
	AddChecklist,
	CreateWorkItem,
	ListWorkItems,
	MoveWorkItem,
	PMDeleteChecklistItem,
	PMUpdateChecklistItem,
	PostComment,
	ReadWorkItem,
	UpdateWorkItem,
} from '../../gadgets/pm/index.js';
import { Tmux } from '../../gadgets/tmux.js';
import { TodoDelete, TodoUpdateStatus, TodoUpsert } from '../../gadgets/todo/index.js';
import type { ToolManifest } from '../contracts/index.js';
import type { IntegrationCategory } from '../definitions/schema.js';
import {
	CAPABILITY_REGISTRY,
	type Capability,
	getCapabilityIntegration,
	isBuiltInCapability,
} from './registry.js';

// ============================================================================
// Integration Checker Type
// ============================================================================

/**
 * Callback to check if an integration category is available for a project.
 * Used to filter optional capabilities based on project configuration.
 */
export type IntegrationChecker = (category: IntegrationCategory) => boolean;

// ============================================================================
// Gadget Constructor Map
// ============================================================================

/**
 * Maps gadget names to their constructor functions.
 * This allows building gadgets from capability definitions.
 */
// biome-ignore lint/suspicious/noExplicitAny: Gadget constructors have varying signatures
const GADGET_CONSTRUCTORS: Record<string, new () => any> = {
	// fs:read
	ListDirectory,
	ReadFile,
	RipGrep,
	AstGrep,

	// fs:write
	WriteFile,
	FileSearchAndReplace,
	FileMultiEdit,
	VerifyChanges,

	// shell:exec
	Tmux,
	Sleep,

	// session:ctrl
	Finish,
	TodoUpsert,
	TodoUpdateStatus,
	TodoDelete,

	// pm:read
	ReadWorkItem,
	ListWorkItems,

	// pm:write
	UpdateWorkItem,
	CreateWorkItem,
	MoveWorkItem,
	PostComment,
	AddChecklist,

	// pm:checklist
	PMUpdateChecklistItem,
	PMDeleteChecklistItem,

	// scm:read
	GetPRDetails,
	GetPRDiff,
	GetPRChecks,

	// scm:ci-logs
	GetCIRunLogs,

	// scm:comment
	PostPRComment,
	UpdatePRComment,
	GetPRComments,
	ReplyToReviewComment,

	// scm:review
	CreatePRReview,

	// scm:pr
	CreatePR,

	// email:read
	SearchEmails,
	ReadEmail,
	MarkEmailAsSeen,

	// email:write
	SendEmail,
	ReplyToEmail,
};

// ============================================================================
// Integration Derivation
// ============================================================================

/**
 * Derive required integration categories from capabilities.
 * Returns unique categories for all non-builtin capabilities.
 */
export function deriveRequiredIntegrations(caps: Capability[]): IntegrationCategory[] {
	const integrations = new Set<IntegrationCategory>();
	for (const cap of caps) {
		const integration = getCapabilityIntegration(cap);
		if (integration !== null) {
			integrations.add(integration);
		}
	}
	return [...integrations];
}

/**
 * Derive integration requirements from both required and optional capabilities.
 * Returns separate arrays for required and optional integrations.
 */
export function deriveIntegrations(
	requiredCaps: Capability[],
	optionalCaps: Capability[],
): { required: IntegrationCategory[]; optional: IntegrationCategory[] } {
	const required = deriveRequiredIntegrations(requiredCaps);
	const requiredSet = new Set(required);

	// Optional integrations are those from optional caps that aren't already required
	const optional = new Set<IntegrationCategory>();
	for (const cap of optionalCaps) {
		const integration = getCapabilityIntegration(cap);
		if (integration !== null && !requiredSet.has(integration)) {
			optional.add(integration);
		}
	}

	return { required, optional: [...optional] };
}

// ============================================================================
// Capability Resolution
// ============================================================================

/**
 * Resolve effective capabilities based on project integration availability.
 *
 * Required capabilities are always included (validation happens separately).
 * Optional capabilities are included only if their integration is available.
 */
export function resolveEffectiveCapabilities(
	requiredCaps: Capability[],
	optionalCaps: Capability[],
	hasIntegration: (category: IntegrationCategory) => boolean,
): Capability[] {
	const effective: Capability[] = [...requiredCaps];

	for (const cap of optionalCaps) {
		// Built-in capabilities are always available
		if (isBuiltInCapability(cap)) {
			effective.push(cap);
			continue;
		}

		// Integration-based capabilities need their integration available
		const integration = getCapabilityIntegration(cap);
		if (integration && hasIntegration(integration)) {
			effective.push(cap);
		}
	}

	return effective;
}

/**
 * Get unavailable optional capabilities for system prompt injection.
 * Returns capabilities that would be available if integrations were configured.
 */
export function getUnavailableOptionalCapabilities(
	optionalCaps: Capability[],
	hasIntegration: (category: IntegrationCategory) => boolean,
): Capability[] {
	const unavailable: Capability[] = [];

	for (const cap of optionalCaps) {
		if (isBuiltInCapability(cap)) continue;

		const integration = getCapabilityIntegration(cap);
		if (integration && !hasIntegration(integration)) {
			unavailable.push(cap);
		}
	}

	return unavailable;
}

// ============================================================================
// Gadget Building
// ============================================================================

/**
 * Build gadget instances from a list of capabilities.
 * Returns fresh gadget instances for each call.
 */
export function buildGadgetsFromCapabilities(caps: Capability[]): unknown[] {
	const gadgets: unknown[] = [];
	const seenGadgets = new Set<string>();

	for (const cap of caps) {
		const def = CAPABILITY_REGISTRY[cap];
		for (const gadgetName of def.gadgetNames) {
			// Avoid duplicates (capabilities may share gadgets)
			if (seenGadgets.has(gadgetName)) continue;
			seenGadgets.add(gadgetName);

			const Constructor = GADGET_CONSTRUCTORS[gadgetName];
			if (!Constructor) {
				throw new Error(
					`Gadget constructor not found: ${gadgetName}. Check CAPABILITY_REGISTRY and GADGET_CONSTRUCTORS are in sync.`,
				);
			}
			gadgets.push(new Constructor());
		}
	}

	return gadgets;
}

/**
 * Get gadget names from capabilities (for tool manifest filtering).
 */
export function getGadgetNamesFromCapabilities(caps: Capability[]): string[] {
	const names = new Set<string>();
	for (const cap of caps) {
		const def = CAPABILITY_REGISTRY[cap];
		for (const name of def.gadgetNames) {
			names.add(name);
		}
	}
	return [...names];
}

// ============================================================================
// SDK Tools
// ============================================================================

/**
 * Get SDK tool names from capabilities.
 * These are the tools available for the Claude Code backend.
 */
export function getSdkToolsFromCapabilities(caps: Capability[]): string[] {
	const tools = new Set<string>();
	for (const cap of caps) {
		const def = CAPABILITY_REGISTRY[cap];
		for (const tool of def.sdkToolNames) {
			tools.add(tool);
		}
	}
	return [...tools];
}

// ============================================================================
// Tool Manifest Filtering
// ============================================================================

/**
 * Filter tool manifests to only those allowed by capabilities.
 * Used by Claude Code backend to filter available tools.
 *
 * Logs a warning if expected tools from capabilities are not found in manifests.
 */
export function filterToolManifests(allTools: ToolManifest[], caps: Capability[]): ToolManifest[] {
	const allowedNames = new Set(getGadgetNamesFromCapabilities(caps));
	const filtered = allTools.filter((tool) => allowedNames.has(tool.name));

	// Check for missing expected tools
	const foundNames = new Set(filtered.map((t) => t.name));
	const missing = [...allowedNames].filter((name) => !foundNames.has(name));
	if (missing.length > 0) {
		console.warn(
			`[capabilities] Expected tools not found in manifests: ${missing.join(', ')}. Check that gadget names in CAPABILITY_REGISTRY match tool manifest names.`,
		);
	}

	return filtered;
}

// ============================================================================
// System Prompt Generation
// ============================================================================

/**
 * Generate a system prompt note for unavailable optional capabilities.
 * This helps the agent understand which tools are missing and why.
 */
export function generateUnavailableCapabilitiesNote(unavailableCaps: Capability[]): string | null {
	if (unavailableCaps.length === 0) return null;

	// Group by integration
	const byIntegration = new Map<IntegrationCategory, string[]>();
	for (const cap of unavailableCaps) {
		const integration = getCapabilityIntegration(cap);
		if (!integration) continue;

		if (!byIntegration.has(integration)) {
			byIntegration.set(integration, []);
		}

		const def = CAPABILITY_REGISTRY[cap];
		byIntegration.get(integration)?.push(...def.gadgetNames);
	}

	const lines: string[] = ['NOTE: Some optional capabilities are unavailable:'];

	const integrationLabels: Record<IntegrationCategory, string> = {
		pm: 'PM integration (Trello/JIRA)',
		scm: 'SCM integration (GitHub)',
		email: 'Email integration',
	};

	for (const [integration, gadgetNames] of byIntegration) {
		const label = integrationLabels[integration];
		const uniqueGadgets = [...new Set(gadgetNames)];
		lines.push(`- ${label} not configured. Tools unavailable: ${uniqueGadgets.join(', ')}`);
	}

	lines.push('Proceed without using the above tools.');

	return lines.join('\n');
}

// ============================================================================
// Integration Checker Factory
// ============================================================================

/**
 * Create an IntegrationChecker for a project.
 *
 * This function pre-fetches integration availability for all categories
 * and returns a synchronous checker callback.
 */
export async function createIntegrationChecker(projectId: string): Promise<IntegrationChecker> {
	// Import integration checking functions dynamically to avoid circular deps
	const [{ hasPmIntegration }, { hasScmIntegration }, { hasEmailIntegration }] = await Promise.all([
		import('../../pm/integration.js'),
		import('../../github/integration.js'),
		import('../../email/integration.js'),
	]);

	// Pre-fetch all integration statuses in parallel
	const [hasPm, hasScm, hasEmail] = await Promise.all([
		hasPmIntegration(projectId),
		hasScmIntegration(projectId),
		hasEmailIntegration(projectId),
	]);

	// Return synchronous checker
	const availableIntegrations: Record<IntegrationCategory, boolean> = {
		pm: hasPm,
		scm: hasScm,
		email: hasEmail,
	};

	return (category: IntegrationCategory) => availableIntegrations[category] ?? false;
}
