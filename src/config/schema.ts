import { z } from 'zod';
import { EngineSettingsSchema } from './engineSettings.js';

const AgentEngineConfigSchema = z.object({
	default: z.string().default('llmist'),
	overrides: z.record(z.string()).default({}),
});

const JiraConfigSchema = z.object({
	projectKey: z.string().min(1),
	baseUrl: z.string().url(),
	statuses: z.record(z.string()), // CASCADE status names → JIRA status IDs/names
	issueTypes: z.record(z.string()).optional(),
	customFields: z
		.object({
			cost: z.string().optional(),
		})
		.optional(),
	labels: z
		.object({
			processing: z.string().default('cascade-processing'),
			processed: z.string().default('cascade-processed'),
			error: z.string().default('cascade-error'),
			readyToProcess: z.string().default('cascade-ready'),
		})
		.optional(),
});

export const ProjectConfigSchema = z.object({
	id: z.string().min(1),
	orgId: z.string().min(1),
	name: z.string().min(1),
	repo: z
		.string()
		.regex(/^[^/]+\/[^/]+$/, 'Must be in format "owner/repo"')
		.optional(),
	baseBranch: z.string().default('main'),
	branchPrefix: z.string().default('feature/'),

	pm: z
		.object({
			type: z.enum(['trello', 'jira']).default('trello'),
		})
		.default({ type: 'trello' }),

	trello: z
		.object({
			boardId: z.string().min(1),
			lists: z.record(z.string()),
			labels: z.record(z.string()),
			customFields: z
				.object({
					cost: z.string().optional(),
				})
				.optional(),
		})
		.optional(),

	jira: JiraConfigSchema.optional(),

	model: z.string().default('openrouter:google/gemini-3-flash-preview'),
	agentModels: z.record(z.string()).optional(),
	maxIterations: z.number().int().positive().default(50),
	watchdogTimeoutMs: z
		.number()
		.int()
		.positive()
		.default(30 * 60 * 1000), // 30 min max job duration
	progressModel: z.string().default('openrouter:google/gemini-2.5-flash-lite'),
	progressIntervalMinutes: z.number().positive().default(5),
	workItemBudgetUsd: z.number().positive().default(5),
	agentEngine: AgentEngineConfigSchema.optional(),
	engineSettings: EngineSettingsSchema.optional(),
	squintDbUrl: z.string().url().optional(),
	runLinksEnabled: z.boolean().default(false),
	maxInFlightItems: z.number().int().positive().optional(),
});

export const CascadeConfigSchema = z.object({
	projects: z.array(ProjectConfigSchema).min(1),
});

export function validateConfig(config: unknown): z.infer<typeof CascadeConfigSchema> {
	return CascadeConfigSchema.parse(config);
}
