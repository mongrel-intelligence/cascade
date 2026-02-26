import { z } from 'zod';

// ============================================================================
// Agent Definition Schema
// ============================================================================

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

const ToolsSchema = z.object({
	/** Named tool set references resolved via TOOL_SET_REGISTRY */
	sets: z.array(
		z.enum(['pm', 'pm_checklist', 'session', 'github_review', 'github_ci', 'email', 'all']),
	),
	/** SDK tools preset: "all" or "readOnly" */
	sdkTools: z.enum(['all', 'readOnly']),
});

const GadgetBuilderOptionsSchema = z
	.object({
		includeReviewComments: z.boolean().optional(),
	})
	.optional();

const StrategiesSchema = z.object({
	contextPipeline: z.array(
		z.enum([
			'directoryListing',
			'contextFiles',
			'squint',
			'workItem',
			'prContext',
			'prConversation',
		]),
	),
	taskPromptBuilder: z.enum(['workItem', 'commentResponse', 'review', 'ci', 'prCommentResponse']),
	gadgetBuilder: z.enum(['workItem', 'review', 'prAgent']),
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
	compaction: z.enum(['implementation', 'default']),
	hint: z.string(),
	trailingMessage: TrailingMessageSchema,
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
