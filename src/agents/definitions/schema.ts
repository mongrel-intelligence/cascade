import { z } from 'zod';
import { CAPABILITIES } from '../capabilities/registry.js';

// ============================================================================
// Agent Definition Schema
// ============================================================================

// Integration categories (aligned with integrationRoles.ts)
export const IntegrationCategorySchema = z.enum(['pm', 'scm', 'email', 'sms']);

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

export const CONTEXT_STEP_NAMES = [
	'directoryListing',
	'contextFiles',
	'squint',
	'workItem',
	'prContext',
	'prConversation',
	'prefetchedEmails',
] as const;

export const COMPACTION_NAMES = ['implementation', 'default'] as const;

/**
 * Strategies schema - context and prompt configuration.
 * Note: gadgetBuilder removed - gadgets are now derived from capabilities.
 * Note: taskPromptBuilder removed - task prompts are now stored in prompts.taskPrompt.
 */
const StrategiesSchema = z.object({
	/** Pipeline of context fetching steps */
	contextPipeline: z.array(z.enum(CONTEXT_STEP_NAMES)),
	/** Optional gadget configuration for special cases */
	gadgetOptions: GadgetOptionsSchema,
});

const BackendSchema = z.object({
	enableStopHooks: z.boolean(),
	needsGitHubToken: z.boolean(),
	blockGitPush: z.boolean().optional(),
	requiresPR: z.boolean().optional(),
	preExecute: z.enum(['postInitialPRComment']).optional(),
	postConfigure: z.enum(['sequentialGadgetExecution']).optional(),
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
 */
export const AgentDefinitionSchema = z.object({
	/** Agent identity for UI display */
	identity: IdentitySchema,
	/**
	 * Capabilities define what the agent can do.
	 * Integrations and tools are DERIVED from capabilities.
	 */
	capabilities: CapabilitiesSchema,
	/** Strategy configuration (context pipeline, prompts) */
	strategies: StrategiesSchema,
	/** Backend execution configuration */
	backend: BackendSchema,
	/** Context compaction strategy */
	compaction: z.enum(COMPACTION_NAMES),
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
