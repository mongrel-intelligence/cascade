import { z } from 'zod';
import { CAPABILITIES } from '../capabilities/registry.js';

// ============================================================================
// Agent Definition Schema
// ============================================================================

// Integration categories (aligned with integrationRoles.ts)
export const IntegrationCategorySchema = z.enum(['pm', 'scm', 'email', 'sms']);

// Known providers for validation
export const KnownProviderSchema = z.enum(['trello', 'jira', 'github', 'imap', 'gmail', 'twilio']);

// Trigger event format validation: {category}:{event-name}
const TriggerEventSchema = z
	.string()
	.regex(
		/^(pm|scm|email|sms):[a-z][a-z0-9-]*$/,
		'Event must be in format {category}:{event-name} (e.g., pm:status-changed, scm:check-suite-success)',
	);

// ============================================================================
// Trigger Parameter Schema
// ============================================================================

/**
 * Parameter definition for agent triggers.
 * Supports string, email, boolean, and select types.
 */
export const TriggerParameterSchema = z
	.object({
		/** Parameter name (used as key in configuration) */
		name: z.string(),
		/** Parameter type - determines input widget */
		type: z.enum(['string', 'email', 'boolean', 'select']),
		/** Human-readable label for the parameter */
		label: z.string(),
		/** Optional description for help text */
		description: z.string().optional(),
		/** Whether the parameter is required (cannot be true if defaultValue is set) */
		required: z.boolean().default(false),
		/** Default value for the parameter (type must match parameter type) */
		defaultValue: z.union([z.string(), z.boolean(), z.number()]).optional(),
		/** Options for 'select' type parameters */
		options: z.array(z.string()).optional(),
	})
	.refine(
		(p) => {
			// Validate defaultValue type matches parameter type
			if (p.defaultValue === undefined) return true;
			if (p.type === 'boolean') return typeof p.defaultValue === 'boolean';
			if (p.type === 'string' || p.type === 'email' || p.type === 'select') {
				return typeof p.defaultValue === 'string';
			}
			return true;
		},
		{ message: 'defaultValue type must match parameter type' },
	)
	.refine(
		(p) => {
			// If defaultValue is set, required should be false
			if (p.defaultValue !== undefined && p.required === true) {
				return false;
			}
			return true;
		},
		{ message: 'Parameter with defaultValue cannot be required' },
	);

// ============================================================================
// Context Step Names (used by trigger contextPipeline definitions)
// ============================================================================

export const CONTEXT_STEP_NAMES = [
	'directoryListing',
	'contextFiles',
	'squint',
	'workItem',
	'prContext',
	'prConversation',
	'prefetchedEmails',
] as const;

/** Context step name schema for use in triggers */
const ContextStepNameSchema = z.enum(CONTEXT_STEP_NAMES);

// ============================================================================
// Supported Trigger Schema
// ============================================================================

/**
 * Trigger that an agent can be activated by.
 * Uses category-prefixed naming: {category}:{event}
 *
 * Examples:
 * - pm:status-changed (work item status changed, replaces pm:card-moved and pm:issue-transitioned)
 * - scm:check-suite-success (CI passed)
 * - email:received (new email received)
 */
export const SupportedTriggerSchema = z.object({
	/** Event identifier, e.g., 'pm:status-changed', 'scm:check-suite-success' */
	event: TriggerEventSchema,
	/** Human-readable label for the trigger */
	label: z.string(),
	/** Optional description for help text */
	description: z.string().optional(),
	/** Whether the trigger is enabled by default */
	defaultEnabled: z.boolean().default(true),
	/** Configurable parameters for this trigger */
	parameters: z.array(TriggerParameterSchema).default([]),
	/** Provider filter - only applies to these providers (e.g., ['trello']) */
	providers: z.array(KnownProviderSchema).optional(),
	/**
	 * Context pipeline for this trigger.
	 * Defines what context to fetch when this trigger fires.
	 * Different triggers typically need different context (e.g., PM triggers
	 * need workItem, SCM triggers need prContext).
	 * When not specified, an empty pipeline is used.
	 */
	contextPipeline: z.array(ContextStepNameSchema).optional(),
});

// ============================================================================
// Integration Requirements Schema
// ============================================================================

/**
 * Explicit integration requirements for an agent.
 * Replaces the implicit derivation from capabilities.
 */
export const IntegrationRequirementsSchema = z
	.object({
		/** Integration categories the agent REQUIRES */
		required: z.array(IntegrationCategorySchema).default([]),
		/** Integration categories the agent CAN USE if available */
		optional: z.array(IntegrationCategorySchema).default([]),
	})
	.refine(
		(data) => {
			const overlap = data.required.filter((c) => data.optional.includes(c));
			return overlap.length === 0;
		},
		{ message: 'Integration cannot be both required and optional' },
	);

const IdentitySchema = z.object({
	emoji: z.string(),
	label: z.string(),
	roleHint: z.string(),
	initialMessage: z.string(),
});

// ============================================================================
// Capability-Centric Schema
// ============================================================================

/**
 * Capability names validated against the registry.
 * Format: {source}:{action} (e.g., 'fs:read', 'pm:write', 'scm:pr')
 */
const CapabilitySchema = z.enum(CAPABILITIES);

/**
 * Capabilities schema with required and optional arrays.
 *
 * Required capabilities: Agent fails validation if integration not configured
 * Optional capabilities: Enabled if integration available, gracefully skipped if not
 *
 * Integrations are DERIVED from capability prefixes - no separate declaration needed.
 */
const CapabilitiesSchema = z
	.object({
		/** Capabilities the agent MUST have - fails if integration not configured */
		required: z.array(CapabilitySchema),
		/** Capabilities the agent CAN use if available */
		optional: z.array(CapabilitySchema).default([]),
	})
	.refine(
		(data) => {
			const requiredSet = new Set(data.required);
			return !data.optional.some((cap) => requiredSet.has(cap));
		},
		{ message: 'A capability cannot be both required and optional' },
	);

/**
 * Optional gadget builder options for special cases.
 * Most agents won't need this - capabilities determine tools automatically.
 */
const GadgetOptionsSchema = z
	.object({
		/** Include GetPRComments and ReplyToReviewComment gadgets (for PR comment response agents) */
		includeReviewComments: z.boolean().optional(),
	})
	.optional();

/**
 * Strategies schema - gadget configuration only.
 * Note: gadgetBuilder removed - gadgets are now derived from capabilities.
 * Note: taskPromptBuilder removed - task prompts are now stored in prompts.taskPrompt.
 * Note: contextPipeline removed - context is now derived from triggers only.
 */
const StrategiesSchema = z.object({
	/** Optional gadget configuration for special cases */
	gadgetOptions: GadgetOptionsSchema,
});

/**
 * SCM-specific hook configuration.
 * Controls stop-hook behavior and push/PR requirements for SCM-integrated agents.
 */
export const ScmHooksSchema = z.object({
	/** Whether to enable stop hooks that check for uncommitted/unpushed changes */
	enableStopHooks: z.boolean().optional(),
	/** Whether to block git push in hooks (set false for agents working on existing PR branches) */
	blockGitPush: z.boolean().optional(),
	/** Whether the agent must create a PR before finishing */
	requiresPR: z.boolean().optional(),
	/** Whether the agent must submit a review before finishing */
	requiresReview: z.boolean().optional(),
	/** Whether the agent must have pushed changes before finishing */
	requiresPushedChanges: z.boolean().optional(),
});

/**
 * Category-scoped hook configuration.
 * Extensible for future categories (e.g., hooks.email, hooks.pm).
 */
export const HooksSchema = z.object({
	/** SCM (source control) hook configuration */
	scm: ScmHooksSchema.optional(),
});

const BackendSchema = z.object({
	/**
	 * @deprecated Use hooks.scm.enableStopHooks instead.
	 * Kept for backward compatibility — new format wins when both are present.
	 */
	enableStopHooks: z.boolean().optional(),
	needsGitHubToken: z.boolean(),
	/**
	 * @deprecated Use hooks.scm.blockGitPush instead.
	 * Kept for backward compatibility — new format wins when both are present.
	 */
	blockGitPush: z.boolean().optional(),
	/**
	 * @deprecated Use hooks.scm.requiresPR instead.
	 * Kept for backward compatibility — new format wins when both are present.
	 */
	requiresPR: z.boolean().optional(),
	/** Category-scoped hook configuration */
	hooks: HooksSchema.optional(),
});

const TrailingMessageSchema = z
	.object({
		includeDiagnostics: z.boolean().optional(),
		includeTodoProgress: z.boolean().optional(),
		includeGitStatus: z.boolean().optional(),
		includePRStatus: z.boolean().optional(),
		includeReminder: z.boolean().optional(),
	})
	.optional();

const PromptsSchema = z.object({
	systemPrompt: z.string().optional(),
	taskPrompt: z.string().min(1, 'taskPrompt is required and must be non-empty'),
});

/**
 * Complete agent definition schema.
 *
 * Key design: capabilities.required/optional determine everything:
 * - Which integrations are required (derived from capability prefixes)
 * - Which gadgets are available (from capability registry)
 * - Which SDK tools are enabled (from capability registry)
 *
 * NEW: Explicit integrations and triggers can be defined independently of capabilities.
 * - integrations: Explicit required/optional integration categories
 * - triggers: Supported trigger events with configurable parameters
 */
export const AgentDefinitionSchema = z.object({
	/** Agent identity for UI display */
	identity: IdentitySchema,
	/**
	 * Explicit integration requirements.
	 * If not specified, integrations are derived from capabilities.
	 */
	integrations: IntegrationRequirementsSchema.optional(),
	/**
	 * Capabilities define what the agent can do.
	 * Integrations and tools are DERIVED from capabilities.
	 */
	capabilities: CapabilitiesSchema,
	/**
	 * Supported triggers that can activate this agent.
	 * Declares what events the agent can respond to, with configurable parameters.
	 */
	triggers: z.array(SupportedTriggerSchema).default([]),
	/** Strategy configuration (gadget options) */
	strategies: StrategiesSchema,
	/** Backend execution configuration */
	backend: BackendSchema,
	/** Iteration guidance hint for the agent */
	hint: z.string(),
	/** Trailing message configuration */
	trailingMessage: TrailingMessageSchema,
	/** Custom prompts (taskPrompt required, systemPrompt optional) */
	prompts: PromptsSchema,
});

/**
 * Partial update schema for agent definitions.
 * Allows updating individual top-level fields without requiring the full definition.
 */
export const DefinitionPatchSchema = AgentDefinitionSchema.partial();

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

export type IntegrationCategory = z.infer<typeof IntegrationCategorySchema>;

/** Capability type re-export for convenience */
export type { Capability } from '../capabilities/registry.js';

/** Agent capabilities (required + optional) */
export type AgentCapabilities = z.infer<typeof CapabilitiesSchema>;

/** Trigger parameter definition */
export type TriggerParameter = z.infer<typeof TriggerParameterSchema>;

/** Supported trigger definition */
export type SupportedTrigger = z.infer<typeof SupportedTriggerSchema>;

/** Context step name */
export type ContextStepName = (typeof CONTEXT_STEP_NAMES)[number];

/** Integration requirements (explicit required/optional) */
export type IntegrationRequirements = z.infer<typeof IntegrationRequirementsSchema>;

/** Known provider (trello, jira, github, etc.) */
export type KnownProvider = z.infer<typeof KnownProviderSchema>;

/** SCM hook configuration */
export type ScmHooks = z.infer<typeof ScmHooksSchema>;

/** Category-scoped hook configuration */
export type Hooks = z.infer<typeof HooksSchema>;
