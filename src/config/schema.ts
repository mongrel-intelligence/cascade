import { z } from 'zod';

const AgentBackendConfigSchema = z.object({
	default: z.string().default('llmist'),
	overrides: z.record(z.string()).default({}),
	subscriptionCostZero: z.boolean().default(false),
});

export const ProjectConfigSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	repo: z.string().regex(/^[^/]+\/[^/]+$/, 'Must be in format "owner/repo"'),
	baseBranch: z.string().default('main'),
	branchPrefix: z.string().default('feature/'),

	trello: z.object({
		boardId: z.string().min(1),
		lists: z.record(z.string()),
		labels: z.record(z.string()),
		customFields: z
			.object({
				cost: z.string().optional(),
			})
			.optional(),
	}),

	prompts: z.record(z.string()).optional(),
	model: z.string().optional(),
	agentModels: z.record(z.string()).optional(),
	cardBudgetUsd: z.number().positive().optional(),
	agentBackend: AgentBackendConfigSchema.optional(),
});

export const CascadeConfigSchema = z.object({
	defaults: z
		.object({
			model: z.string().default('openrouter:google/gemini-3-flash-preview'),
			agentModels: z.record(z.string()).default({}),
			maxIterations: z.number().int().positive().default(50),
			agentIterations: z.record(z.number().int().positive()).default({}),
			freshMachineTimeoutMs: z
				.number()
				.int()
				.positive()
				.default(5 * 60 * 1000), // 5 min - exit if no work received after boot
			watchdogTimeoutMs: z
				.number()
				.int()
				.positive()
				.default(30 * 60 * 1000), // 30 min max job duration
			postJobGracePeriodMs: z.number().int().nonnegative().default(5000), // 5 sec grace before exit
			cardBudgetUsd: z.number().positive().default(5),
			agentBackend: z.string().default('llmist'),
			progressModel: z.string().default('openrouter:google/gemini-2.5-flash-lite'),
			progressIntervalMinutes: z.number().positive().default(5),
		})
		.default({}),
	projects: z.array(ProjectConfigSchema).min(1),
});

export function validateConfig(config: unknown): z.infer<typeof CascadeConfigSchema> {
	return CascadeConfigSchema.parse(config);
}
