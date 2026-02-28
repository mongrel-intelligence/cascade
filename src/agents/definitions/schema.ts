import { z } from 'zod';

// ============================================================================
// Agent Definition Schema
// ============================================================================

// Integration categories (aligned with integrationRoles.ts)
export const IntegrationCategorySchema = z.enum(['pm', 'scm', 'email', 'sms']);

// Integration requirements schema (REQUIRED field)
const IntegrationsSchema = z
	.object({
		/** Integrations that MUST be configured for the agent to run */
		required: z.array(IntegrationCategorySchema),
		/**
		 * Integrations the agent CAN use if available (for future use).
		 * Currently not validated - reserved for dashboard filtering and
		 * conditional agent behavior based on available integrations.
		 */
		optional: z.array(IntegrationCategorySchema),
	})
	.refine(
		(data) => {
			const requiredSet = new Set(data.required);
			return !data.optional.some((cat) => requiredSet.has(cat));
		},
		{ message: 'A category cannot be both required and optional' },
	);

const IdentitySchema = z.object({
	emoji: z.string(),
	label: z.string(),
	roleHint: z.string(),
	initialMessage: z.string(),
});

const CapabilitiesSchema = z.object({
	canEditFiles: z.boolean(),
	canCreatePR: z.boolean(),
	canUpdateChecklists: z.boolean(),
	isReadOnly: z.boolean(),
	canAccessEmail: z.boolean().optional(),
});

export const TOOL_SET_NAMES = [
	'pm',
	'pm_checklist',
	'session',
	'github_review',
	'github_ci',
	'email',
	'all',
] as const;

export const SDK_TOOLS_NAMES = ['all', 'readOnly'] as const;

const ToolsSchema = z.object({
	/** Named tool set references resolved via TOOL_SET_REGISTRY */
	sets: z.array(z.enum(TOOL_SET_NAMES)),
	/** SDK tools preset: "all" or "readOnly" */
	sdkTools: z.enum(SDK_TOOLS_NAMES),
});

const GadgetBuilderOptionsSchema = z
	.object({
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

export const TASK_PROMPT_BUILDER_NAMES = [
	'workItem',
	'commentResponse',
	'review',
	'ci',
	'prCommentResponse',
	'emailJoke',
] as const;

export const GADGET_BUILDER_NAMES = ['workItem', 'review', 'prAgent', 'emailJoke'] as const;

export const COMPACTION_NAMES = ['implementation', 'default'] as const;

const StrategiesSchema = z.object({
	contextPipeline: z.array(z.enum(CONTEXT_STEP_NAMES)),
	taskPromptBuilder: z.enum(TASK_PROMPT_BUILDER_NAMES),
	gadgetBuilder: z.enum(GADGET_BUILDER_NAMES),
	gadgetBuilderOptions: GadgetBuilderOptionsSchema,
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

export const AgentDefinitionSchema = z.object({
	identity: IdentitySchema,
	capabilities: CapabilitiesSchema,
	tools: ToolsSchema,
	strategies: StrategiesSchema,
	backend: BackendSchema,
	compaction: z.enum(COMPACTION_NAMES),
	hint: z.string(),
	trailingMessage: TrailingMessageSchema,
	integrations: IntegrationsSchema,
});

/**
 * Partial update schema for agent definitions.
 * Allows updating individual top-level fields without requiring the full definition.
 */
export const DefinitionPatchSchema = AgentDefinitionSchema.partial();

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

export type IntegrationCategory = z.infer<typeof IntegrationCategorySchema>;

export type AgentIntegrations = z.infer<typeof IntegrationsSchema>;
