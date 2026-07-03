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
 * Per-project worker-image lifecycle (spec 022; `building` added in spec 023).
 * Answers "is there a runnable image + may spawn launch it":
 * `pending` — set but not yet validated; `building` — a build is in progress for a
 * dockerfile-sourced project; `verified` — validated/built, pin recorded;
 * `failed` — validation/build rejected the source (see `workerImageError`).
 */
export const WorkerImageStatusSchema = z.enum(['pending', 'building', 'verified', 'failed']);
export type WorkerImageStatus = z.infer<typeof WorkerImageStatusSchema>;

/**
 * Per-project worker-image (re)build attempt status (spec 023). Tracks the most
 * recent build ATTEMPT independently of {@link WorkerImageStatusSchema}: NULL =
 * idle, `building` = a build is running, `failed` = the last build failed. Kept
 * separate so a failed rebuild never strands the still-runnable verified pin.
 */
export const WorkerImageBuildStatusSchema = z.enum(['building', 'failed']);
export type WorkerImageBuildStatus = z.infer<typeof WorkerImageBuildStatusSchema>;

/**
 * Derived (never stored) effective image source for a project (spec 023):
 * `dockerfile` (worker_dockerfile set) > `reference` (worker_image set) > `default`.
 */
export const WorkerImageSourceSchema = z.enum(['default', 'reference', 'dockerfile']);
export type WorkerImageSource = z.infer<typeof WorkerImageSourceSchema>;

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
	 * Per-project wall timeout (ms) for `.cascade/setup.sh`. Optional with NO
	 * `.default()` — absent or `0` means no per-project wall timeout (the global
	 * worker/watchdog container timeout is the safety net); a positive value is
	 * passed as `wallTimeoutMs` to the setup-script `runCommand` call.
	 * `.nonnegative()` (NOT `.positive()`) so an explicit `0` ("disable") is legal.
	 */
	setupTimeoutMs: z.number().int().nonnegative().optional(),

	/**
	 * Per-project worker image (spec 022). All optional with NO `.default()` —
	 * absent means fall back to the global router-level default image.
	 * Dormant until plans 2-4 wire spawn resolution, validation, and UI.
	 */
	workerImage: z.string().optional(),
	workerImageDigest: z.string().optional(),
	workerImageStatus: WorkerImageStatusSchema.optional(),
	workerImageError: z.string().optional(),

	/**
	 * Per-project worker Dockerfile (spec 023). All optional with NO `.default()`.
	 * `workerDockerfile` — operator's extra-layers content; `workerImageBuildHash`
	 * — content-hash of the desired content; `workerImageBuildStatus` — most recent
	 * (re)build attempt status. `workerImageSource` is DERIVED by the config mapper
	 * (dockerfile > reference > default), never persisted. Dormant until plans 2-5.
	 */
	workerDockerfile: z.string().optional(),
	workerImageBuildHash: z.string().optional(),
	workerImageBuildStatus: WorkerImageBuildStatusSchema.optional(),
	workerImageSource: WorkerImageSourceSchema.optional(),
});

export const CascadeConfigSchema = z.object({
	projects: z.array(ProjectConfigSchema).min(1),
});

export function validateConfig(config: unknown): z.infer<typeof CascadeConfigSchema> {
	return CascadeConfigSchema.parse(config);
}
