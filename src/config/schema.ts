import { z } from 'zod';
import { jiraConfigSchema } from '../integrations/pm/jira/config-schema.js';
import { linearConfigSchema } from '../integrations/pm/linear/config-schema.js';
import { trelloConfigSchema } from '../integrations/pm/trello/config-schema.js';
import { EngineSettingsSchema } from './engineSettings.js';
import { UpdateChannelSchema } from './updateChannel.js';

export const PROJECT_DEFAULTS = {
	model: 'openrouter:google/gemini-3-flash-preview',
	maxIterations: 50,
	watchdogTimeoutMs: 30 * 60 * 1000, // 30 min
	progressModel: 'openrouter:google/gemini-2.5-flash-lite',
	progressIntervalMinutes: 5,
	workItemBudgetUsd: 5,
	agentEngine: 'claude-code',
} as const;

const AgentEngineConfigSchema = z.object({
	default: z.string().default(PROJECT_DEFAULTS.agentEngine),
	overrides: z.record(z.string()).default({}),
});

/**
 * Per-project worker-image validation lifecycle (spec 022).
 * `pending` — set but not yet validated; `verified` — validated, digest pinned;
 * `failed` — validation rejected the reference (see `workerImageError`).
 */
export const WorkerImageStatusSchema = z.enum(['pending', 'verified', 'failed']);
export type WorkerImageStatus = z.infer<typeof WorkerImageStatusSchema>;

// Plan 009/5 removed the inline Trello / JIRA / Linear config schemas.
// Each provider's manifest now owns its schema (see
// `src/integrations/pm/<provider>/config-schema.ts`). The project config
// below imports those schemas directly so there's a single source of
// truth — no more two-layer drift (#1138 / #1142 class).

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

	// Optional: SCM-only projects have no PM provider. Absent `pm` (or a project
	// with no trello/jira/linear integration) leaves this `undefined` — it is NOT
	// defaulted to Trello (that silently broke SCM-only projects). See
	// src/pm/no-pm-provider.ts.
	pm: z
		.object({
			type: z.enum(['trello', 'jira', 'linear']),
		})
		.optional(),

	trello: trelloConfigSchema.optional(),

	jira: jiraConfigSchema.optional(),

	linear: linearConfigSchema.optional(),

	model: z.string().default(PROJECT_DEFAULTS.model),
	agentModels: z.record(z.string()).optional(),
	maxIterations: z.number().int().positive().default(PROJECT_DEFAULTS.maxIterations),
	watchdogTimeoutMs: z.number().int().positive().default(PROJECT_DEFAULTS.watchdogTimeoutMs), // 30 min max job duration
	progressModel: z.string().default(PROJECT_DEFAULTS.progressModel),
	progressIntervalMinutes: z.number().positive().default(PROJECT_DEFAULTS.progressIntervalMinutes),
	workItemBudgetUsd: z.number().positive().default(PROJECT_DEFAULTS.workItemBudgetUsd),
	agentEngine: AgentEngineConfigSchema.optional(),
	engineSettings: EngineSettingsSchema.optional(),
	/**
	 * Per-agent engine settings overrides keyed by agent type.
	 * Populated from agent_configs rows at config load time.
	 * Used by buildExecutionPlan() to merge into the execution plan's engineSettings.
	 */
	agentEngineSettings: z.record(z.string(), EngineSettingsSchema).optional(),
	/**
	 * Per-agent update-channel overrides keyed by agent type.
	 * Populated from agent_configs.update_channel rows at config load time.
	 * Absent / NULL means the agent inherits the default channel (`both`).
	 * Read at runtime via resolveUpdateChannel() in src/config/updateChannel.ts.
	 */
	agentUpdateChannels: z.record(z.string(), UpdateChannelSchema).optional(),
	runLinksEnabled: z.boolean().default(false),
	maxInFlightItems: z.number().int().positive().optional(),
	snapshotEnabled: z.boolean().optional(),
	snapshotTtlMs: z.number().int().positive().optional(),

	/**
	 * Per-project worker image (spec 022). All optional with NO `.default()` —
	 * absent means fall back to the global router-level default image.
	 * Dormant until plans 2-4 wire spawn resolution, validation, and UI.
	 */
	workerImage: z.string().optional(),
	workerImageDigest: z.string().optional(),
	workerImageStatus: WorkerImageStatusSchema.optional(),
	workerImageError: z.string().optional(),
});

export const CascadeConfigSchema = z.object({
	projects: z.array(ProjectConfigSchema).min(1),
});

export function validateConfig(config: unknown): z.infer<typeof CascadeConfigSchema> {
	return CascadeConfigSchema.parse(config);
}
