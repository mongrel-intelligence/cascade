import { z } from 'zod';

export const TriggerConfigSchema = z.object({
	type: z.string(),
	enabled: z.boolean().default(true),
	agentType: z.string(),
	listId: z.string().optional(),
	labelId: z.string().optional(),
});

export const ProjectConfigSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	repo: z.string().regex(/^[^/]+\/[^/]+$/, 'Must be in format "owner/repo"'),
	baseBranch: z.string().default('main'),
	branchPrefix: z.string().default('feature/'),
	githubTokenEnv: z.string().default('GITHUB_TOKEN'),

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

	triggers: z.array(TriggerConfigSchema).optional(),
	prompts: z.record(z.string()).optional(),
	model: z.string().optional(),
	agentModels: z.record(z.string()).optional(),
});

export const CascadeConfigSchema = z.object({
	defaults: z
		.object({
			model: z.string().default('gemini:gemini-2.5-flash'),
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
		})
		.default({}),
	projects: z.array(ProjectConfigSchema).min(1),
});

export function validateConfig(config: unknown): z.infer<typeof CascadeConfigSchema> {
	return CascadeConfigSchema.parse(config);
}
